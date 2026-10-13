import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { DesktopLoginStore } = await jiti.import("./desktop-login-store.ts");
const session = { providerId: "haze-oidc", refreshToken: "test-refresh", expiresAt: 999999,
  principal: { subject: "user-1", name: "Test", permissions: [] } };

test("only the initiating desktop can claim a valid, single-use OAuth result", () => {
  const store = new DesktopLoginStore();
  const pending = store.start("/?session=task-1");
  assert.deepEqual(store.claim(pending.requestId, pending.claimToken), { status: "pending" });
  assert.equal(store.bind(pending.requestId, "state-1"), true);
  assert.equal(store.bind(pending.requestId, "state-2"), false);
  assert.equal(store.complete(pending.requestId, "state-2", session), false);
  assert.equal(store.claim(pending.requestId, "wrong-secret"), null);
  store.cancel(pending.requestId, "wrong-secret");
  assert.equal(store.complete(pending.requestId, "state-1", session), true);
  assert.equal(store.complete(pending.requestId, "state-1", session), false);
  assert.deepEqual(store.claim(pending.requestId, pending.claimToken), { status: "complete", session, returnTo: "/?session=task-1" });
  assert.equal(store.claim(pending.requestId, pending.claimToken), null);
});

test("expired and cancelled requests cannot accept or release credentials", () => {
  let now = 1000;
  const store = new DesktopLoginStore(() => now);
  const expired = store.start("/");
  store.bind(expired.requestId, "expired-state");
  now = expired.expiresAt;
  assert.equal(store.complete(expired.requestId, "expired-state", session), false);
  assert.equal(store.claim(expired.requestId, expired.claimToken), null);
  const cancelled = store.start("/");
  store.bind(cancelled.requestId, "cancelled-state");
  store.cancel(cancelled.requestId, cancelled.claimToken);
  assert.equal(store.complete(cancelled.requestId, "cancelled-state", session), false);
});

test("only a matching OAuth state can fail a request; simultaneous desktops remain isolated", () => {
  const store = new DesktopLoginStore();
  const first = store.start("/");
  const second = store.start("/");
  store.bind(first.requestId, "first-state");
  store.bind(second.requestId, "second-state");
  store.fail(first.requestId, "bad-state", "access_denied");
  assert.deepEqual(store.claim(first.requestId, first.claimToken), { status: "pending" });
  assert.equal(store.claim(first.requestId, second.claimToken), null);
  store.fail(first.requestId, "first-state", "access_denied");
  assert.deepEqual(store.claim(first.requestId, first.claimToken), { status: "failed", error: "access_denied" });
  assert.deepEqual(store.claim(second.requestId, second.claimToken), { status: "pending" });
});

test("old requests are pruned and pending memory is bounded", () => {
  let now = 0;
  const store = new DesktopLoginStore(() => now);
  for (let i = 0; i < 128; i++) store.start("/");
  assert.throws(() => store.start("/"));
  now = 600000;
  assert.ok(store.start("/").requestId);
});
