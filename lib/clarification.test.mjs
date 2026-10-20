import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { AgentSessionWrapper, EUREKA_NATIVE_PLAN_EXTENSION } = await jiti.import("./rpc-manager.ts");
const { ClarificationRuntime } = await jiti.import("./clarification-runtime.ts");
const { readClarificationState } = await jiti.import("./clarification.ts");
const { validateUserInputResponse } = await jiti.import("./user-input.ts");
const { EMPTY_PLAN_STATE } = await jiti.import("./plan-mode.ts");

const questions = [{ title: "日期", question: "查询哪个时间范围？", selection: "single", options: [
  { id: "yesterday", label: "昨天", description: "上一自然日" },
  { id: "week", label: "最近七天", description: "过去七个完整自然日" },
] }];
function fixture(t, tools = ["read", "bash"], entries = []) {
  const handlers = {}, registered = {}, runs = [], events = [];
  let activeTools = [...tools];
  const manager = {
    getEntries: () => entries, getBranch: () => entries, getCwd: () => resolve("."), getSessionId: () => "clarification-test",
    appendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data: structuredClone(data) }); },
  };
  const inner = {
    sessionId: "clarification-test", sessionManager: manager, isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: { systemPrompt: "base" } },
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    getActiveToolNames: () => activeTools, setActiveToolsByName: (names) => { activeTools = [...names]; },
    getAllTools: () => ["read", "bash", "request_user_input"].map((name) => ({ name })),
    clearQueue: () => ({ steering: [], followUp: [] }), getSteeringMessages: () => [], getFollowUpMessages: () => [],
    getContextUsage: () => undefined, dispose() {},
    prompt(text, options) {
      let finish, fail;
      const promise = new Promise((res, rej) => { finish = res; fail = rej; });
      runs.push({ text, options, finish, fail, tools: [...activeTools] });
      options.preflightResult?.(true);
      return promise;
    },
  };
  EUREKA_NATIVE_PLAN_EXTENSION.factory({ registerTool: (tool) => { registered[tool.name] = tool; }, on: (name, fn) => { handlers[name] = fn; }, appendEntry: (type, data) => manager.appendCustomEntry(type, data) });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onEvent((event) => events.push(event));
  t.after(() => wrapper.destroy());
  const ctx = { cwd: resolve("."), sessionManager: manager };
  return { wrapper, inner, entries, runs, events, ctx, handlers, registered, ask: () => registered.request_user_input.execute("question-call", { questions }, undefined, undefined, ctx) };
}
const tick = () => new Promise((r) => setImmediate(r));

test("ordinary requests default off; explicit preference opens only this task, and no-tools stays empty", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "含糊的问题" });
  assert.equal(f.runs[0].tools.includes("request_user_input"), false);
  f.runs[0].finish(); await tick();
  await f.wrapper.send({ type: "prompt", message: "开启澄清", clarificationEnabled: true });
  assert.equal(f.runs[1].tools.includes("request_user_input"), true);
  f.runs[1].finish(); await tick();
  assert.equal(f.inner.getActiveToolNames().includes("request_user_input"), false);
  await f.wrapper.send({ type: "prompt", message: "又一个普通问题" });
  assert.equal(f.runs[2].tools.includes("request_user_input"), false);
  f.runs[2].finish(); await tick();
  const disabled = fixture(t, []);
  await disabled.wrapper.send({ type: "prompt", message: "禁止工具", clarificationEnabled: true });
  assert.deepEqual(disabled.runs[0].tools, []);
  await assert.rejects(disabled.ask(), /未开放/);
  disabled.runs[0].finish();
});

test("accepted questions stop the turn, block later tools and hold each queued request's preference and images", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "查询", clarificationEnabled: true });
  const images = [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }];
  await f.wrapper.send({ type: "prompt", message: "排队不澄清", clarificationEnabled: false, streamingBehavior: "followUp", images });
  const result = await f.ask();
  assert.equal(result.terminate, true);
  assert.equal(await f.inner.agent.shouldStopAfterTurn({}), true);
  assert.equal(f.handlers.tool_call({ toolName: "bash" }, f.ctx).block, true);
  await assert.rejects(f.wrapper.send({ type: "prompt", message: "不能绕过等待" }), /澄清/);
  f.runs[0].finish(); await tick();
  assert.equal(f.runs.length, 1);
  const state = await f.wrapper.send({ type: "get_clarification" });
  assert.equal(state.queue[0].clarificationEnabled, false);
  assert.deepEqual(state.queue[0].images, images);
  assert.equal(readClarificationState(f.entries).groups[0].status, "pending");
  const responses = state.groups[0].questions.map((q) => ({ questionId: q.id, optionIds: ["week"] }));
  await Promise.all([1, 2, 3].map(() => f.wrapper.send({ type: "answer_clarification", groupId: "question-call", responses })));
  assert.equal(f.runs.length, 2, "duplicate answers only start one continuation");
  assert.match(f.runs[1].text, /最近七天/);
  f.runs[1].finish(); await tick(); await tick();
  assert.equal(f.runs.length, 3);
  assert.equal(f.runs[2].text, "排队不澄清");
  assert.equal(f.runs[2].tools.includes("request_user_input"), false);
  assert.deepEqual(f.runs[2].options.images, images);
  f.runs[2].finish();
});

test("answers survive continuation errors; explicit retries are idempotent and cancellation never starts queued work", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "查询", clarificationEnabled: true });
  await f.ask(); f.runs[0].finish(); await tick();
  const group = readClarificationState(f.entries).groups[0];
  const responses = group.questions.map((q) => ({ questionId: q.id, customAnswer: "本月" }));
  await f.wrapper.send({ type: "answer_clarification", groupId: group.id, responses });
  f.runs[1].fail(new Error("provider unavailable")); await tick();
  const failed = readClarificationState(f.entries).groups[0];
  assert.equal(failed.continuation, "failed");
  assert.equal(failed.questions[0].answer.text, "本月");
  await f.wrapper.send({ type: "answer_clarification", groupId: group.id, responses });
  assert.equal(f.runs.length, 2, "reposting answers cannot retry a failed query");
  await Promise.all([1, 2].map(() => f.wrapper.send({ type: "retry_clarification", groupId: group.id })));
  assert.equal(f.runs.length, 3);
  f.runs[2].fail(new Error("still unavailable")); await tick();
  await f.wrapper.send({ type: "cancel_clarification", groupId: group.id });
  assert.equal(readClarificationState(f.entries).groups[0].status, "cancelled");
  assert.equal(f.runs.length, 3);
  assert.ok(f.events.some((e) => e.type === "clarification_state"));
});

test("runtime reconstruction restores pending and failed answers without calling a model", () => {
  const entries = [], store = { getEntries: () => entries, appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }) };
  const runtime = new ClarificationRuntime(store, () => {});
  runtime.task = { id: "task", clarificationEnabled: true, plugins: [] }; runtime.allowed = true;
  const group = runtime.ask("group", questions);
  assert.equal(new ClarificationRuntime(store, () => {}).pending.id, group.id);
  runtime.answer(group.id, [{ questionId: group.questions[0].id, skipped: true }]);
  runtime.update({ ...runtime.group(group.id), continuation: "running" });
  const restored = new ClarificationRuntime(store, () => {});
  assert.equal(restored.group(group.id).continuation, "failed");
  assert.equal(restored.group(group.id).questions[0].answer.skipped, true);
});

test("cancelling before the tool round settles still stops execution and never drains old queued queries", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "含糊查询", clarificationEnabled: true });
  await f.wrapper.send({ type: "prompt", message: "旧查询", streamingBehavior: "followUp" });
  await f.ask();
  await f.wrapper.send({ type: "cancel_clarification", groupId: "question-call" });
  assert.equal(f.handlers.tool_call({ toolName: "bash" }, f.ctx).block, true);
  assert.equal(await f.inner.agent.shouldStopAfterTurn({}), true);
  f.runs[0].finish(); await tick();
  assert.equal(f.runs.length, 1);
  assert.equal(readClarificationState(f.entries).queue[0].paused, true);
  await f.wrapper.send({ type: "prompt", message: "新的普通请求" });
  f.runs[1].finish(); await tick();
  assert.equal(f.runs.length, 2, "new requests do not silently authorize the cancelled task's queued queries");
  const recalled = await f.wrapper.send({ type: "clear_queue" });
  assert.deepEqual(recalled.followUp, ["旧查询"]);
});

test("disabling tools while awaiting answers preserves the answers but prevents continuation", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "查询", clarificationEnabled: true });
  await f.ask(); f.runs[0].finish(); await tick();
  await f.wrapper.send({ type: "set_tools", toolNames: [] });
  const group = readClarificationState(f.entries).groups[0];
  await assert.rejects(f.wrapper.send({ type: "answer_clarification", groupId: group.id, responses: group.questions.map((q) => ({ questionId: q.id, optionIds: ["week"] })) }), /权限/);
  assert.equal(f.runs.length, 1);
  assert.equal(readClarificationState(f.entries).groups[0].questions[0].answer.text, "最近七天");
  assert.equal(readClarificationState(f.entries).groups[0].continuation, "failed");
});

test("plan mode still asks through its legacy state and uses the shared interaction tool once", async (t) => {
  const f = fixture(t);
  f.inner.sessionManager.appendCustomEntry("eureka_plan", { ...EMPTY_PLAN_STATE, planModeActive: true, phase: "planning" });
  const result = await f.ask();
  assert.equal(result.terminate, true);
  assert.equal(f.entries.at(-1).customType, "eureka_plan");
  assert.equal(f.entries.at(-1).data.questions.length, 1);
  assert.equal(Object.keys(f.registered).filter((name) => name === "request_user_input").length, 1);
  assert.equal(await f.inner.agent.shouldStopAfterTurn({}), true);
});

test("shared validation supports multiple choices, custom and skipped answers and rejects invalid combinations", () => {
  const q = { ...questions[0], selection: "multiple", id: "q" };
  assert.deepEqual(validateUserInputResponse(q, { optionIds: ["week", "yesterday"] }).optionIds, ["week", "yesterday"]);
  assert.equal(validateUserInputResponse(q, { customAnswer: "今年" }).text, "今年");
  assert.equal(validateUserInputResponse(q, { skipped: true }).skipped, true);
  assert.throws(() => validateUserInputResponse(q, { customAnswer: "今年", optionIds: ["week"] }));
  assert.throws(() => validateUserInputResponse(q, { optionIds: ["invented"] }));
});

test("real SDK loop stops after a mixed tool batch without sending the post-question query or another model request", async (t) => {
  const f = fixture(t);
  await f.wrapper.send({ type: "prompt", message: "模糊查询", clarificationEnabled: true });
  let modelCalls = 0, reads = 0, queries = 0;
  const native = f.registered.request_user_input;
  const agent = new Agent({
    initialState: { model: { id: "test", provider: "test", api: "openai-completions" }, tools: [
      { name: "read", label: "read", description: "read", parameters: Type.Object({}), execute: async () => { reads++; return { content: [{ type: "text", text: "context" }] }; } },
      { ...native, execute: (_id, params) => native.execute("question-call", params, undefined, undefined, f.ctx) },
      { name: "query", label: "query", description: "query", parameters: Type.Object({}), execute: async () => { queries++; return { content: [{ type: "text", text: "data" }] }; } },
    ] },
    beforeToolCall: async ({ toolCall }) => f.handlers.tool_call({ toolName: toolCall.name }, f.ctx),
    shouldStopAfterTurn: f.inner.agent.shouldStopAfterTurn,
    streamFn: () => {
      modelCalls++;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => stream.push({ type: "done", reason: "toolUse", message: {
        role: "assistant", api: "openai-completions", provider: "test", model: "test", stopReason: "toolUse", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [
          { type: "toolCall", id: "read", name: "read", arguments: {} },
          { type: "toolCall", id: "question-call", name: "request_user_input", arguments: { questions } },
          { type: "toolCall", id: "query", name: "query", arguments: {} },
        ],
      } }));
      return stream;
    },
  });
  await agent.prompt("查询");
  assert.equal(reads, 1);
  assert.equal(queries, 0);
  assert.equal(modelCalls, 1);
  f.runs[0].finish();
});
