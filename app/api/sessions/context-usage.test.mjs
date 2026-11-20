import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, interopDefault: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const sdk = await jiti.import("@earendil-works/pi-coding-agent");
const { GET } = await jiti.import("./[id]/context-usage/route.ts");
const { AgentSessionWrapper, getRpcSession } = await jiti.import("@/server/agent/rpc-manager");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("@/features/sessions/server/session-reader");
const { readContextSnapshot, saveContextSnapshot, contextRevision } = await jiti.import("@/features/chat/shared/context-snapshot");
const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 50 };
const usage = { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (tokens = usage) => ({ role: "assistant", content: [{ type: "text", text: "reply" }], provider: "fixture", model: "fixture-model", api: "openai-completions", usage: tokens, stopReason: "stop", timestamp: Date.now() });
const read = (id, leaf) => GET(new Request(`http://localhost/api/sessions/${id}/context-usage${leaf ? `?leafId=${leaf}` : ""}`), { params: Promise.resolve({ id }) });

async function readDetails(id, leaf) {
  const response = await read(id, leaf);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function installHistoryRuntime(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "eureka-context-models-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authPath = resolve(directory, "auth.json");
  const modelsPath = resolve(directory, "models.json");
  await writeFile(authPath, "{}");
  await writeFile(modelsPath, JSON.stringify({ providers: { fixture: {
    baseUrl: "https://unused.invalid/v1", api: "openai-completions",
    models: ["fixture-model", "other-model"].map((id) => ({ id, name: id, contextWindow: 1000, maxTokens: 100 })),
  } } }));
  // Exercise the real SDK runtime and the Azure compatibility adapter, while
  // keeping credentials, catalogs and model definitions inside this fixture.
  const runtime = await sdk.ModelRuntime.create({
    authPath, modelsPath, modelsStorePath: resolve(directory, "models-store.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel("fixture", "fixture-model").contextWindow, 1000);
  t.mock.method(sdk.ModelRuntime, "create", async (options) => {
    assert.equal(options.allowModelNetwork, false);
    assert.equal(options.refreshOnCreate, false);
    return runtime;
  });
  t.mock.method(sdk.SettingsManager, "create", () => ({ getCompactionSettings: () => settings }));
  return runtime;
}

function install(t, { messages, reported, manager, prompt = "fixture prompt", tools = [], file = "" }) {
  const previous = globalThis.__piSessions;
  const inner = {
    sessionManager: manager,
    agent: { state: { messages, systemPrompt: prompt, tools } },
    settingsManager: { getCompactionSettings: () => settings },
    autoCompactionEnabled: true,
    model: { provider: "fixture", id: "fixture-model" },
    getContextUsage: () => reported,
  };
  globalThis.__piSessions = new Map([["context-fixture", { isAlive: () => true, inner, sessionFile: file }]]);
  t.after(() => { globalThis.__piSessions = previous; });
}

test("live context uses the existing session and sends counts rather than prompt/tool bodies", async (t) => {
  install(t, { messages: [assistant()], reported: { tokens: 600, contextWindow: 1000, percent: 60 }, manager: { getLeafId: () => "current" }, tools: [{ name: "read", description: "private tool body", parameters: {} }] });
  const response = await read("context-fixture");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.source, "live");
  assert.equal(data.usage.tokens, 600);
  assert.equal(data.usageEstimated, false);
  assert.equal(data.breakdown.reduce((sum, part) => sum + part.tokens, 0), 600);
  assert.doesNotMatch(JSON.stringify(data), /fixture prompt|private tool body|reply/);
});

test("trailing tool results and unknown usage are labelled as estimates", async (t) => {
  install(t, { messages: [assistant(), { role: "toolResult", content: [{ type: "text", text: "new result" }] }], reported: { tokens: 620, contextWindow: 1000, percent: 62 }, manager: { getLeafId: () => "current" } });
  assert.equal((await (await read("context-fixture")).json()).usageEstimated, true);
});

test("history respects branch selection and discards pre-compaction usage", async (t) => {
  const manager = sdk.SessionManager.inMemory(process.cwd());
  manager.appendModelChange("fixture", "fixture-model");
  const userId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() });
  const before = manager.appendMessage(assistant());
  const compacted = manager.appendCompaction("Short context summary", userId, 600);
  manager.appendMessage({ role: "user", content: "new branch", timestamp: Date.now() });
  install(t, { messages: [], reported: undefined, manager, file: "fixture-never-read.jsonl" });
  await installHistoryRuntime(t);
  const old = await readDetails("context-fixture", before);
  assert.equal(old.source, "history");
  assert.equal(old.usage.tokens, 600);
  assert.equal(old.canCompact, false);
  const after = await readDetails("context-fixture", compacted);
  assert.equal(after.usageEstimated, true);
  assert.ok(after.usage.tokens < 600);
  assert.equal(after.breakdown.find((part) => part.id === "system").tokens, null);
  assert.equal((await read("context-fixture", "missing")).status, 404);
});

test("context edits invalidate earlier reported usage instead of displaying pre-edit tokens", async (t) => {
  const manager = sdk.SessionManager.inMemory(process.cwd());
  manager.appendModelChange("fixture", "fixture-model");
  const user = manager.appendMessage({ role: "user", content: "Large original request".repeat(50), timestamp: Date.now() });
  const before = manager.appendMessage(assistant());
  const edited = manager.appendContextEdit(user, { content: "Short" });
  manager.appendMessage({ role: "user", content: "Next request", timestamp: Date.now() });
  install(t, { messages: [], reported: undefined, manager, file: "fixture-never-read.jsonl" });
  await installHistoryRuntime(t);
  assert.equal((await readDetails("context-fixture", before)).usage.tokens, 600);
  const details = await readDetails("context-fixture", edited);
  assert.equal(details.usageEstimated, true);
  assert.ok(details.usage.tokens < 600);
});

test("switching back restores numeric categories after the live session is gone", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "eureka-context-"));
  t.after(async () => { invalidateSessionPathCache("context-fixture"); await rm(directory, { recursive: true, force: true }); });
  const manager = sdk.SessionManager.create(process.cwd(), directory);
  manager.appendModelChange("fixture", "fixture-model");
  const userId = manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  manager.appendMessage(assistant());
  const file = manager.getSessionFile();
  cacheSessionPath("context-fixture", file);
  install(t, { messages: manager.buildSessionContext().messages, reported: { tokens: 600, contextWindow: 1000, percent: 60 }, manager, file, prompt: "private instructions <available_skills>private skills</available_skills>", tools: [{ name: "read", description: "private schema", parameters: {} }] });
  const live = await (await read("context-fixture")).json();
  const stored = await readFile(`${file}.context-usage.json`, "utf8");
  assert.doesNotMatch(stored, /private instructions|private skills|private schema|reply/);
  globalThis.__piSessions = new Map();
  await installHistoryRuntime(t);
  const restored = await readDetails("context-fixture");
  assert.equal(restored.source, "snapshot");
  assert.equal(restored.usageEstimated, true);
  assert.equal(restored.usage.tokens, live.usage.tokens);
  assert.deepEqual(restored.breakdown, live.breakdown);
  for (const part of restored.breakdown) assert.equal(typeof part.tokens, "number");
  // A different branch must not borrow this snapshot.
  const historical = await readDetails("context-fixture", userId);
  assert.equal(historical.source, "history");
  assert.equal(historical.breakdown.find((part) => part.id === "system").tokens, null);
  // Neither a model change nor a compaction may reuse the old totals.
  manager.appendModelChange("fixture", "other-model");
  assert.equal((await readDetails("context-fixture")).source, "history");
  manager.appendCompaction("summary", userId, 600);
  const compacted = await readDetails("context-fixture");
  assert.equal(compacted.source, "history");
  assert.ok(compacted.usage.tokens < 600);
});

test("switching sibling branches and reopening preserves each branch's own usage", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "eureka-context-branches-"));
  t.after(async () => { invalidateSessionPathCache("context-fixture"); await rm(directory, { recursive: true, force: true }); });
  const manager = sdk.SessionManager.create(process.cwd(), directory);
  manager.appendModelChange("fixture", "fixture-model");
  const root = manager.appendMessage({ role: "user", content: "choose a branch", timestamp: Date.now() });
  const first = manager.appendMessage(assistant());
  manager.branch(root);
  const second = manager.appendMessage(assistant({ ...usage, input: 125, output: 25, totalTokens: 150 }));
  manager.branch(first);
  const file = manager.getSessionFile();
  cacheSessionPath("context-fixture", file);
  install(t, { messages: manager.buildSessionContext().messages, reported: { tokens: 600, contextWindow: 1000, percent: 60 }, manager, file });
  assert.equal((await readDetails("context-fixture", first)).source, "live");
  globalThis.__piSessions = new Map();
  await installHistoryRuntime(t);

  const firstRestored = await readDetails("context-fixture", first);
  assert.equal(firstRestored.source, "snapshot");
  assert.equal(firstRestored.usage.tokens, 600);
  const secondRestored = await readDetails("context-fixture", second);
  assert.equal(secondRestored.source, "history");
  assert.equal(secondRestored.usage.tokens, 150);
  assert.equal(secondRestored.usage.contextWindow, 1000);
  assert.equal(secondRestored.usage.percent, 15);
  assert.equal((await readDetails("context-fixture", first)).usage.tokens, 600);
});

test("renaming a live session does not make its existing message leaf lose runtime categories", async (t) => {
  const manager = sdk.SessionManager.inMemory(process.cwd());
  manager.appendModelChange("fixture", "fixture-model");
  const leaf = manager.appendMessage(assistant());
  manager.appendSessionInfo("renamed");
  install(t, { messages: manager.buildSessionContext().messages, reported: { tokens: 600, contextWindow: 1000, percent: 60 }, manager });
  const data = await (await read("context-fixture", leaf)).json();
  assert.equal(data.source, "live");
  assert.equal(typeof data.breakdown.find((part) => part.id === "system").tokens, "number");
  assert.equal(contextRevision(manager.getBranch()), leaf);
});

test("snapshots reject a different session/model, corrupt data and unavailable storage", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "eureka-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = resolve(directory, "fixture.jsonl");
  const details = { sessionId: "one", model: "fixture/model", usage: { tokens: 10, contextWindow: 100, percent: 10 }, breakdown: [{ id: "system", tokens: 10 }], reserveTokens: 5 };
  await saveContextSnapshot(file, "leaf", details);
  assert.equal(await readContextSnapshot(file, "two", "leaf", details.model), null);
  assert.equal(await readContextSnapshot(file, "one", "leaf", "different/model"), null);
  await writeFile(`${file}.context-usage.json`, "broken JSON");
  assert.equal(await readContextSnapshot(file, "one", "leaf", details.model), null);
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  assert.equal(await saveContextSnapshot(resolve(directory, "missing", "fixture.jsonl"), "leaf", details), false);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("ENOENT"));
});

async function runtimeFixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "eureka-context-runtime-"));
  const manager = sdk.SessionManager.create(process.cwd(), directory);
  manager.appendModelChange("fixture", "fixture-model");
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  let eventListener;
  const inner = {
    sessionId: "context-fixture", sessionFile: manager.getSessionFile(), sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: { messages: manager.buildSessionContext().messages, systemPrompt: "private instructions <available_skills>private skills</available_skills>", tools: [{ name: "read", parameters: {} }] } },
    settingsManager: { getCompactionSettings: () => settings },
    autoCompactionEnabled: true, model: { provider: "fixture", id: "fixture-model" },
    getContextUsage: () => ({ tokens: 600, contextWindow: 1000, percent: 60 }),
    getSteeringMessages: () => [], getFollowUpMessages: () => [],
    getActiveToolNames: () => ["read"], setActiveToolsByName() {},
    extensionRunner: {}, dispose() {},
    subscribe(listener) { eventListener = listener; return () => {}; },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(async () => { wrapper.destroy(); await rm(directory, { recursive: true, force: true }); });
  return { inner, wrapper, manager, emit: (type) => eventListener({ type }) };
}

test("task completion saves counts without ever opening or fetching the context inspector", async (t) => {
  const { inner, wrapper, manager, emit } = await runtimeFixture(t);
  wrapper.start();
  manager.appendMessage(assistant());
  inner.agent.state.messages = manager.buildSessionContext().messages;
  emit("agent_end");
  let revision = contextRevision(manager.getBranch());
  const saved = await readContextSnapshot(inner.sessionFile, inner.sessionId, revision, "fixture/fixture-model");
  assert.equal(saved.source, "snapshot");
  assert.ok(saved.breakdown.find((part) => part.id === "system").tokens > 0);
  assert.ok(saved.breakdown.find((part) => part.id === "tools").tokens > 0);
  manager.appendCustomEntry("eureka_plan", { phase: "completed" });
  assert.equal(contextRevision(manager.getBranch()), revision);
  assert.notEqual(await readContextSnapshot(inner.sessionFile, inner.sessionId, contextRevision(manager.getBranch()), saved.model), null);
  for (const type of ["compaction_end", "auto_compaction_end"]) {
    manager.appendCompaction("short summary", manager.getBranch().find((entry) => entry.type === "message").id, 600);
    inner.agent.state.messages = manager.buildSessionContext().messages;
    inner.getContextUsage = () => undefined;
    emit(type);
    revision = contextRevision(manager.getBranch());
    const compacted = await readContextSnapshot(inner.sessionFile, inner.sessionId, revision, saved.model);
    assert.equal(compacted.source, "snapshot");
    assert.ok(compacted.usage.tokens < 600);
  }
});

test("existing wrappers gain automatic snapshots on lookup after hot reload", async (t) => {
  const { inner, wrapper, manager } = await runtimeFixture(t);
  manager.appendMessage(assistant());
  inner.agent.state.messages = manager.buildSessionContext().messages;
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[inner.sessionId, wrapper]]);
  t.after(() => { globalThis.__piSessions = previous; });
  assert.equal(getRpcSession(inner.sessionId), wrapper);
  assert.equal(getRpcSession(inner.sessionId), wrapper);
  const saved = await readContextSnapshot(inner.sessionFile, inner.sessionId, contextRevision(manager.getBranch()), "fixture/fixture-model");
  assert.equal(saved.usage.tokens, 600);
  assert.equal(wrapper.listeners.length, 1);
});

test("overlapping snapshot writes preserve the newest revision", async (t) => {
  const { inner, manager } = await runtimeFixture(t);
  manager.appendMessage(assistant());
  const details = { sessionId: inner.sessionId, model: "fixture/fixture-model", usage: { tokens: 10, contextWindow: 100, percent: 10 }, breakdown: [{ id: "system", tokens: 10 }], reserveTokens: 5 };
  const writes = ["first", "second", "newest"].map((revision) => saveContextSnapshot(inner.sessionFile, revision, details));
  const latest = await readContextSnapshot(inner.sessionFile, inner.sessionId, "newest", details.model);
  assert.equal(latest.usage.tokens, 10);
  assert.deepEqual(await Promise.all(writes), [true, true, true]);
});

test("idle shutdown flushes the final snapshot before disposing runtime state", async (t) => {
  const { inner, wrapper, manager } = await runtimeFixture(t);
  manager.appendMessage(assistant());
  inner.agent.state.messages = manager.buildSessionContext().messages;
  inner.dispose = () => { inner.agent.state = {}; };
  await wrapper.shutdown();
  const saved = await readContextSnapshot(inner.sessionFile, inner.sessionId, contextRevision(manager.getBranch()), "fixture/fixture-model");
  assert.equal(wrapper.isAlive(), false);
  assert.ok(saved.breakdown.find((part) => part.id === "skills").tokens > 0);
});
