import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { resolve } from "node:path";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
  tsconfigPaths: true,
  alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") },
});
const { AgentSessionWrapper } = await jiti.import("../../server/agent/rpc-manager.ts");
const { subscribeSessionCompletions } = await jiti.import("../../features/sessions/server/session-completions.ts");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makePromptInner(prompt) {
  const entries = [];
  return {
    isBashRunning: false,
    isStreaming: false,
    extensionRunner: {},
    sessionManager: {
      getCwd: () => "/tmp", getEntries: () => entries, getBranch: () => entries,
      appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    },
    agent: { state: {} },
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    getActiveToolNames: () => [],
    setActiveToolsByName() {},
    getAllTools: () => [],
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    prompt,
    dispose() {},
  };
}

test("the RPC wrapper publishes one desktop summary after the SDK settles", (t) => {
  const inner = makePromptInner(() => Promise.resolve());
  inner.sessionId = "a9bbef30-40fe-4b88-b196-a56c83e54081";
  const entries = inner.sessionManager.getEntries();
  entries.push({ id: "user", type: "message", message: { role: "user", content: "编制报告" } });
  inner.sessionManager.getLeafId = () => entries.at(-1)?.id ?? null;
  inner.sessionManager.getSessionName = () => "项目报告";
  let receive;
  inner.subscribe = (listener) => {
    receive = listener;
    return () => {};
  };
  const completions = [];
  t.after(subscribeSessionCompletions((completion) => completions.push(completion)));
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.start();

  receive({ type: "agent_start" });
  entries.push({ id: "answer", type: "message", message: { role: "assistant", content: [{ type: "text", text: "**报告已完成。**" }], stopReason: "stop" } });
  receive({ type: "agent_end" });
  assert.deepEqual(completions, []);
  receive({ type: "agent_settled", aborted: false });
  receive({ type: "agent_settled", aborted: false });
  assert.deepEqual(completions, [{ sessionId: inner.sessionId, title: "项目报告", summary: "报告已完成。" }]);
});

test("get_state waits for extension resources before returning the system prompt", async (t) => {
  let finishBinding;
  const inner = makePromptInner(() => Promise.resolve());
  inner.agent.state.systemPrompt = "before extensions";
  inner.bindExtensions = () => new Promise((resolve) => {
    finishBinding = () => {
      inner.agent.state.systemPrompt = "after extensions";
      resolve();
    };
  });

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding();

  let settled = false;
  const statePromise = wrapper.send({ type: "get_state" }).then((state) => {
    settled = true;
    return state;
  });
  await nextTurn();

  assert.equal(settled, false);
  finishBinding();
  const state = await statePromise;

  assert.equal(state.systemPrompt, "after extensions");
});

test("prompt commands wait for SDK preflight acceptance before acknowledging", async (t) => {
  let acceptPreflight;
  let finishPrompt;
  const inner = makePromptInner((_message, options) => new Promise((resolve) => {
    acceptPreflight = () => options.preflightResult("started");
    finishPrompt = resolve;
  }));
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  let acknowledged = false;
  const sending = wrapper.send({ type: "prompt", message: "hello" }).then(() => {
    acknowledged = true;
  });
  await nextTurn();

  assert.equal(acknowledged, false);
  assert.equal(wrapper.isRunning(), true);

  acceptPreflight();
  await sending;

  assert.equal(acknowledged, true);
  assert.equal(wrapper.isRunning(), true);
  assert.equal(events.some((event) => event.type === "prompt_done"), false);

  finishPrompt();
  await nextTurn();

  assert.equal(wrapper.isRunning(), false);
  assert.equal(events.filter((event) => event.type === "prompt_done").length, 1);
});

test("prompt commands reject when SDK preflight fails", async (t) => {
  const inner = makePromptInner(() => {
    return Promise.reject(new Error("Authentication failed"));
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await assert.rejects(
    wrapper.send({ type: "prompt", message: "hello" }),
    /Authentication failed/,
  );

  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(events, []);
});

test("accepted prompt failures still finish through the event stream", async (t) => {
  let failPrompt;
  const inner = makePromptInner((_message, options) => {
    options.preflightResult("started");
    return new Promise((_resolve, reject) => {
      failPrompt = () => reject(new Error("post-accept failure"));
    });
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await wrapper.send({ type: "prompt", message: "hello" });
  failPrompt();
  await nextTurn();

  assert.deepEqual(events.map((event) => event.type), ["prompt_error", "prompt_done"]);
});

test("a follow-up submitted while idle starts an ordinary RPC prompt", async (t) => {
  let receivedOptions;
  const inner = makePromptInner((_message, options) => {
    receivedOptions = options;
    options.preflightResult("started");
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await wrapper.send({
    type: "prompt",
    message: "next",
    streamingBehavior: "followUp",
  });
  await nextTurn();

  assert.equal(receivedOptions.streamingBehavior, undefined);
  assert.equal(receivedOptions.source, "rpc");
  assert.equal(wrapper.isRunning(), false);
  assert.equal(events.some((event) => event.type === "prompt_error"), false);
});

test("prompt admission waits for preflight and holds follow-ups in the host queue until the run settles", async (t) => {
  let callCount = 0;
  let acceptFirst;
  let finishFirst;
  const inner = makePromptInner((_message, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((resolve) => {
        acceptFirst = () => {
          inner.isStreaming = true;
          options.preflightResult("started");
        };
        finishFirst = () => {
          inner.isStreaming = false;
          resolve();
        };
      });
    }

    assert.equal(inner.isStreaming, false);
    options.preflightResult("started");
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const first = wrapper.send({ type: "prompt", message: "first" });
  await nextTurn();
  const queued = wrapper.send({
    type: "prompt",
    message: "queued",
    streamingBehavior: "followUp",
  });
  await nextTurn();

  assert.equal(callCount, 1);
  acceptFirst();
  await Promise.all([first, queued]);
  await nextTurn();

  assert.equal(callCount, 1);
  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, true);

  finishFirst();
  await nextTurn();
  await nextTurn();

  assert.equal(callCount, 2);
  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, false);
});

test("prompt admission continues after the preceding preflight rejects", async (t) => {
  let callCount = 0;
  let rejectFirst;
  const inner = makePromptInner((_message, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        rejectFirst = () => {
          reject(new Error("first rejected"));
        };
      });
    }
    options.preflightResult("started");
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const firstRejected = assert.rejects(
    wrapper.send({ type: "prompt", message: "first" }),
    /first rejected/,
  );
  await nextTurn();
  const second = wrapper.send({ type: "prompt", message: "second" });
  await nextTurn();
  assert.equal(callCount, 1);

  rejectFirst();
  await Promise.all([firstRejected, second]);

  assert.equal(callCount, 2);
  assert.equal(wrapper.isRunning(), false);
});

test("a failing event listener cannot reject prompt completion", async (t) => {
  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });
  console.error = () => {};

  const inner = makePromptInner((_message, options) => {
    options.preflightResult("started");
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const delivered = [];
  wrapper.onEvent(() => {
    throw new Error("listener failed");
  });
  wrapper.onEvent((event) => delivered.push(event.type));

  await wrapper.send({ type: "prompt", message: "hello" });
  await nextTurn();

  assert.deepEqual(delivered, ["prompt_done"]);
  assert.equal(wrapper.isRunning(), false);
});

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    ...makePromptInner(() => Promise.resolve()),
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown still disposes the SDK session when an extension fails", async () => {
  const calls = [];
  const inner = {
    ...makePromptInner(() => Promise.resolve()),
    isBashRunning: false,
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);

  assert.deepEqual(calls, ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction disposes the SDK session before unregistering the wrapper", () => {
  const calls = [];
  const inner = {
    ...makePromptInner(() => Promise.resolve()),
    isBashRunning: false,
    extensionRunner: {},
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  wrapper.destroy();
  wrapper.destroy();

  assert.deepEqual(calls, ["dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});
