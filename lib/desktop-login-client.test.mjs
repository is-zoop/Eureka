import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { loginInBrowser } = await jiti.import("./desktop-login-client.ts");
const pending = { requestId: "request-1", claimToken: "private-claim-secret", expiresAt: Date.now() + 600000,
  browserUrl: "http://127.0.0.1:8080/api/marketplace-auth/start?desktopRequest=request-1" };

function fixture(responses) {
  const calls = [];
  return { calls, request: async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    const next = responses.shift();
    assert.ok(next, "unexpected request");
    return Response.json(next.body ?? next, { status: next.code ?? 200 });
  } };
}

test("opens only the browser launch URL and claims the desktop cookie before continuing", async () => {
  const mock = fixture([pending, { status: "pending" }, { status: "complete", returnTo: "/?session=1" }]);
  const opened = [];
  const target = await loginInBrowser({ returnTo: "/?session=1", signal: new AbortController().signal,
    request: mock.request, wait: async () => {}, onWaiting: () => {}, openBrowser: async (url) => opened.push(url) });
  assert.equal(target, "/?session=1");
  assert.deepEqual(opened, [pending.browserUrl]);
  assert.equal(opened[0].includes(pending.claimToken), false);
  assert.deepEqual(mock.calls.map(c => c.body.action), ["start", "poll", "poll"]);
  assert.equal(mock.calls[1].credentials, "same-origin");
  assert.equal(mock.calls[1].body.claimToken, pending.claimToken);
});

test("a failed browser launch cancels the pending request", async () => {
  const mock = fixture([pending, { status: "cancelled" }]);
  await assert.rejects(loginInBrowser({ returnTo: "/", signal: new AbortController().signal,
    request: mock.request, onWaiting: () => {}, openBrowser: async () => { throw new Error("browser unavailable"); } }), /browser unavailable/);
  assert.deepEqual(mock.calls.map(c => c.body.action), ["start", "cancel"]);
});

test("authorization failures and expired attempts never navigate to the app", async () => {
  for (const response of [{ status: "failed" }, { code: 410, body: { status: "expired" } }]) {
    const mock = fixture([pending, response, { status: "cancelled" }]);
    await assert.rejects(loginInBrowser({ returnTo: "/", signal: new AbortController().signal,
      request: mock.request, wait: async () => {}, onWaiting: () => {}, openBrowser: async () => {} }));
    assert.deepEqual(mock.calls.map(c => c.body.action), ["start", "poll", "cancel"]);
  }
});

test("cancelling while the browser is opening stops polling and cancels server state", async () => {
  const mock = fixture([pending, { status: "cancelled" }]);
  const controller = new AbortController();
  await assert.rejects(loginInBrowser({ returnTo: "/", signal: controller.signal,
    request: mock.request, onWaiting: () => assert.fail("cancelled request should not update UI"),
    openBrowser: async () => controller.abort() }), { name: "AbortError" });
  assert.deepEqual(mock.calls.map(c => c.body.action), ["start", "cancel"]);
});

test("cancellation drains a late successful poll before guest entry can continue", async () => {
  const controller = new AbortController();
  const calls = [];
  let releasePoll;
  let startedPoll;
  const pollStarted = new Promise(resolve => { startedPoll = resolve; });
  const task = loginInBrowser({ returnTo: "/", signal: controller.signal,
    wait: async () => {}, onWaiting: () => {}, openBrowser: async () => {},
    request: async (_url, options) => {
      const { action } = JSON.parse(options.body);
      calls.push(action);
      if (action === "start") return Response.json(pending);
      if (action === "poll") {
        assert.notEqual(options.signal, controller.signal);
        startedPoll();
        return new Promise(resolve => { releasePoll = () => resolve(Response.json({ status: "complete", returnTo: "/?late=1" })); });
      }
      return Response.json({ status: "cancelled" });
    },
  });
  await pollStarted;
  controller.abort();
  let settled = false;
  task.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  releasePoll();
  await assert.rejects(task, { name: "AbortError" });
  assert.deepEqual(calls, ["start", "poll", "cancel"]);
});

test("cancelling during start still cancels the request once its ID arrives", async () => {
  const controller = new AbortController();
  const mock = fixture([pending, { status: "cancelled" }]);
  await assert.rejects(loginInBrowser({ returnTo: "/", signal: controller.signal,
    request: async (...args) => { controller.abort(); return mock.request(...args); },
    onWaiting: () => assert.fail("must not start waiting"), openBrowser: async () => assert.fail("must not open browser") }), { name: "AbortError" });
  assert.deepEqual(mock.calls.map(c => c.body.action), ["start", "cancel"]);
});
