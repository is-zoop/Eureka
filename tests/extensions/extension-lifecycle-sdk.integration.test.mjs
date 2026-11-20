import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { installUiWaitRuntime } = await jiti.import("../../server/agent/ui-wait-runtime.ts");
const { EUREKA_NATIVE_PLAN_EXTENSION, AgentSessionWrapper } = await jiti.import("../../server/agent/rpc-manager.ts");
const { EUREKA_TASK_PROGRESS_EXTENSION } = await jiti.import("../../features/chat/shared/task-progress.ts");
const { EUREKA_PROMPT_POLICY_EXTENSION } = await jiti.import("../../server/agent/session-prompt-policy.ts");
const { describeLiveContext } = await jiti.import("../../features/chat/shared/context-snapshot.ts");
const { EUREKA_AUTOMATION_INTAKE_EXTENSION } = await jiti.import("../../features/automation/authoring/automation-intake-extension.ts");
const { EUREKA_AUTOMATION_CHAT_EXTENSION } = await jiti.import("../../features/automation/runtime/automation-chat-extension.ts");
const { installPluginSelectionRuntime } = await jiti.import("../../server/extensions/plugin-selection-runtime.ts");
const { ClarificationRuntime } = await jiti.import("../../server/agent/clarification-runtime.ts");
const { bindChatAutomations, AUTOMATION_CHAT_TOOL } = await jiti.import("../../features/automation/runtime/automation-chat.ts");
const { bindAutomationTask, activeAutomationTask } = await jiti.import("../../features/automation/runtime/automation-mode-store.ts");
const { AUTOMATION_AUTHOR_SYSTEM } = await jiti.import("../../features/automation/authoring/automation-authoring-guide.ts");
const { localAutomationContext } = await jiti.import("../../features/automation/runtime/automation-local-context.ts");
const { PLAN_MODE_SYSTEM_PROMPT } = await jiti.import("../../features/chat/shared/plan-mode.ts");

const progressMarker = "[EUREKA TASK PROGRESS]";
const count = (text, marker) => text.split(marker).length - 1;
const custom = (content) => ({ customType: "fixture-trigger", content, display: false });
const text = (value) => [{ type: "text", text: value }];
const tick = () => new Promise((resolve) => setImmediate(resolve));

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "eureka-lifecycle-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  environment(t, { PI_CODING_AGENT_DIR: dir });
  await writeFile(join(dir, "auth.json"), "{}");
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("lifecycle-fixture", {
    api: "openai-completions", baseUrl: "https://unused.invalid/v1", apiKey: "fixture-key",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const requests = [], starts = [], events = [], errors = [];
  let pi;
  runtime.registerNativeProvider({ ...runtime.getProvider("lifecycle-fixture"), streamSimple: (_model, context) => {
    assert.ok(requests.length < 8, "fixture must not start an unbounded continuation");
    requests.push({ messages: structuredClone(context.messages), systemPrompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages).map((tool) => tool.name) });
    const content = options.respond?.(requests.length) ?? text("Fixture complete");
    const stopReason = content.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: {
      role: "assistant", api: "openai-completions", provider: "lifecycle-fixture", model: "fixture", content, stopReason, timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }));
    return stream;
  } });
  await runtime.refresh({ allowNetwork: false });
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [
        { name: "fixture-ui-wait", factory: installUiWaitRuntime }, EUREKA_NATIVE_PLAN_EXTENSION, EUREKA_AUTOMATION_INTAKE_EXTENSION, EUREKA_AUTOMATION_CHAT_EXTENSION,
        { name: "fixture-plugin-selection", factory: installPluginSelectionRuntime }, EUREKA_TASK_PROGRESS_EXTENSION,
        { name: "fixture-observer", factory: (api) => {
          pi = api;
          api.on("before_agent_start", async (event, ctx) => {
            starts.push({ messageType: event.messageType, hasPrompt: "prompt" in event, isIdle: ctx.isIdle(), customType: event.messageType === "custom" ? event.message.customType : undefined });
            return options.before?.(event, ctx, api);
          });
        } }, EUREKA_PROMPT_POLICY_EXTENSION,
      ],
    },
  });
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(dir);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: runtime.getModel("lifecycle-fixture", "fixture"), ...(options.tools ? { tools: options.tools } : {}) });
  t.after(() => session.dispose());
  session.subscribe((event) => events.push(event));
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  const controller = new ClarificationRuntime(manager, () => {});
  t.after(() => controller.dispose());
  return { dir, session, manager, controller, requests, starts, events, errors, pi };
}

async function approvePlan(wrapper) {
  await wrapper.send({ type: "set_plan_mode", phase: "planning" });
  await wrapper.send({ type: "submit_plan", content: "# Goal\nComplete a local fixture\n# Implementation steps\n- [ ] Complete fixture\n# Verification\n- [ ] Verify fixture" });
  await wrapper.send({ type: "approve_plan" });
}

async function authorIdentity() {
  const local = localAutomationContext();
  return { id: randomUUID(), ownerKey: local.ownerKey, runtimeId: local.runtimeId };
}

test("user and custom-triggered runs each prepare once with one current progress instruction", async (t) => {
  const f = await fixture(t);
  await f.session.prompt("First user prompt");
  await f.session.sendCustomMessage(custom("Extension continuation"), { triggerTurn: true });
  await f.session.prompt("Second user prompt");
  assert.deepEqual(f.starts.map((start) => start.messageType), ["user", "custom", "user"]);
  assert.deepEqual(f.starts.map((start) => start.hasPrompt), [true, false, true]);
  assert.ok(f.starts.every((start) => !start.isIdle));
  assert.equal(f.requests.length, 3);
  for (const request of f.requests) assert.equal(count(request.systemPrompt, progressMarker), 1);
  assert.equal(f.events.filter((event) => event.type === "agent_start").length, 3);
  assert.deepEqual(f.errors, []);
});

test("SDK UI waits survive SSE reconnect and clear before the provider runs", async t => {
  const f = await fixture(t, { before: async (_event, ctx) => { assert.equal(await ctx.ui.confirm("Fixture approval", "Continue?"), true); } });
  const wrapper = new AgentSessionWrapper(f.session), events = [];
  wrapper.start(); wrapper.onEvent(event => events.push(event)); wrapper.beginExtensionBinding();
  t.after(() => wrapper.destroy());
  const sending = wrapper.send({ type: "prompt", message: "Wait for approval" });
  const deadline = Date.now() + 5000;
  while (!events.some(event => event.type === "extension_ui_request" && event.method === "confirm") && Date.now() < deadline) await tick();
  const request = events.find(event => event.type === "extension_ui_request" && event.method === "confirm");
  assert.ok(request);
  assert.equal((await wrapper.send({ type: "get_state" })).waitingForUser, true);
  assert.equal(f.requests.length, 0);
  const replay = []; const off = wrapper.onEvent(event => replay.push(event)); off();
  assert.ok(replay.some(event => event.type === "ui_wait_state" && event.waitingForUser));
  assert.ok(replay.some(event => event.id === request.id));
  await wrapper.send({ type: "extension_ui_response", id: request.id, confirmed: true });
  await sending; await f.session.waitForIdle(); await tick();
  assert.equal((await wrapper.send({ type: "get_state" })).waitingForUser, false);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.manager.getEntries().filter(entry => entry.type === "custom" && entry.customType === "eureka_ui_wait").map(entry => entry.data.waiting), [true, false]);
});

test("aborting a blocked SDK dialog closes it and prevents the first model request", async t => {
  const f = await fixture(t, { before: async (_event, ctx) => { await ctx.ui.confirm("Abort fixture", "Continue?"); } });
  const wrapper = new AgentSessionWrapper(f.session), events = [];
  wrapper.start(); wrapper.onEvent(event => events.push(event)); wrapper.beginExtensionBinding();
  t.after(() => wrapper.destroy());
  const sending = wrapper.send({ type: "prompt", message: "Await confirmation" });
  const deadline = Date.now() + 5000;
  while (!events.some(event => event.type === "extension_ui_request" && event.method === "confirm") && Date.now() < deadline) await tick();
  assert.equal((await wrapper.send({ type: "get_state" })).waitingForUser, true);
  await wrapper.send({ type: "abort" }); await sending; await tick();
  assert.equal(f.requests.length, 0);
  assert.equal((await wrapper.send({ type: "get_state" })).waitingForUser, false);
  assert.ok(events.some(event => event.type === "extension_ui_closed"));
});

test("native PowerShell remains selected across live permission changes and produces real Unicode output", { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t, { tools: ["read", "powershell", "edit", "write"] });
  const wrapper = new AgentSessionWrapper(f.session); wrapper.start(); t.after(() => wrapper.destroy());
  await wrapper.send({ type: "set_tools", toolNames: ["read", "bash", "edit", "write"] });
  assert.ok(f.session.getActiveToolNames().includes("powershell"));
  assert.ok(!f.session.getActiveToolNames().includes("bash"));
  await wrapper.send({ type: "set_tools", toolNames: ["read", "grep", "find", "ls"] });
  await wrapper.send({ type: "set_tools", toolNames: ["read", "bash", "edit", "write"] });
  assert.ok(f.session.getActiveToolNames().includes("powershell"));
  const tool = f.session.getAllTools().find(tool => tool.name === "powershell");
  assert.ok(tool);
  // Use the public SDK execution boundary, not a second shell implementation.
  const tools = await import("@earendil-works/pi-coding-agent");
  const result = await tools.createPowerShellTool(f.dir).execute("fixture-powershell", { command: "Write-Output '中文 路径测试'" }, new AbortController().signal);
  assert.match(JSON.stringify(result), /中文 路径测试/);
  const controller = new AbortController();
  const pending = tools.createPowerShellTool(f.dir).execute("fixture-cancel", { command: "Start-Sleep -Seconds 30; Write-Output 'not-completed'" }, controller.signal);
  const timer = setTimeout(() => controller.abort(), 200);
  try { await assert.rejects(pending, /abort|cancel/i); } finally { clearTimeout(timer); }
});

test("messages queued by an extension during preflight join the existing run", async (t) => {
  const f = await fixture(t, { before: (_event, _ctx, pi) => pi.sendMessage(custom("Queued once"), { triggerTurn: true, deliverAs: "followUp" }) });
  await f.session.prompt("Start with extension follow-up");
  assert.equal(f.starts.length, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.events.filter((event) => event.type === "agent_start").length, 1);
  const queued = f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "fixture-trigger");
  assert.equal(queued.length, 1);
  for (const request of f.requests) assert.equal(count(request.systemPrompt, progressMarker), 1);
  assert.deepEqual(f.errors, []);
});

test("nextTurn messages accompany a custom-triggered run without starting another request", async (t) => {
  const f = await fixture(t);
  await f.session.sendCustomMessage({ ...custom("Pending next turn"), customType: "fixture-pending" }, { deliverAs: "nextTurn" });
  assert.equal(f.requests.length, 0);
  await f.session.sendCustomMessage(custom("Run now"), { triggerTurn: true });
  assert.equal(f.starts.length, 1);
  assert.equal(f.requests.length, 1);
  for (const type of ["fixture-pending", "fixture-trigger"]) {
    assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === type).length, 1);
  }
  assert.deepEqual(f.errors, []);
});

test("aborting during asynchronous preflight prevents the provider request and later continuation", async (t) => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, { before: async () => { entered.resolve(); await release.promise; } });
  const prompt = f.session.prompt("Cancel before execution");
  await entered.promise;
  assert.equal(f.session.isStreaming, true);
  const abort = f.session.abort();
  release.resolve();
  await Promise.all([prompt, abort]);
  await tick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.session.isStreaming, false);
  assert.equal(f.events.filter((event) => event.type === "agent_settled").length, 1);
  assert.deepEqual(f.errors, []);
});

test("tool-disabled custom runs do not regain automation tools or progress instructions", async (t) => {
  const f = await fixture(t, { tools: [] });
  await f.session.sendCustomMessage(custom("No executable tools"), { triggerTurn: true });
  assert.deepEqual(f.requests[0].tools, []);
  assert.equal(count(f.requests[0].systemPrompt, progressMarker), 0);
  assert.deepEqual(f.session.getActiveToolNames(), []);
  assert.deepEqual(f.errors, []);
});

test("host no-tools policy suppresses extension prompt overrides through supported startup hooks", async (t) => {
  const f = await fixture(t, { before: (_event, _ctx, pi) => {
    pi.setActiveTools(["read"]);
    return { systemPrompt: "Fixture extension override" };
  } });
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start();
  t.after(() => wrapper.destroy());
  f.session.setActiveToolsByName([]);
  wrapper.setForceEmptySystemPrompt(true);
  assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "");
  await f.session.sendCustomMessage(custom("Run without tools"), { triggerTurn: true });
  assert.equal(f.requests[0].systemPrompt, "");
  assert.deepEqual(f.requests[0].tools, []);
  const details = describeLiveContext(f.session);
  assert.equal(details.breakdown.find((part) => part.id === "system").tokens, 0);
  assert.equal(details.breakdown.find((part) => part.id === "tools").tokens, 0);
  wrapper.setForceEmptySystemPrompt(false);
  await f.session.prompt("Explicitly enabled again");
  assert.equal(f.requests[1].systemPrompt, "Fixture extension override");
  assert.deepEqual(f.requests[1].tools, ["read"]);
  assert.deepEqual(f.errors, []);
});

test("custom runs honor current automation selection rather than earlier task permissions", async (t) => {
  const f = await fixture(t);
  const selected = { source: "https://fixture.invalid", capabilityId: "fixture-app", digest: "fixture-digest", automation: { id: "fixture-app", revision: 1, version: "1.0.0" } };
  const unbind = bindChatAutomations(f.manager, [selected]);
  t.after(unbind);
  f.controller.task = { id: "fixture-task", plugins: [{ source: selected.source, capabilityId: selected.capabilityId, digest: selected.digest }], clarificationEnabled: false };
  await f.session.prompt("Selected automation");
  assert.ok(f.requests[0].tools.includes(AUTOMATION_CHAT_TOOL));
  f.controller.task = { ...f.controller.task, id: "next-task", plugins: [] };
  await f.session.sendCustomMessage(custom("Continue after deselection"), { triggerTurn: true });
  assert.ok(!f.requests[1].tools.includes(AUTOMATION_CHAT_TOOL));
  assert.deepEqual(f.errors, []);
});

test("planning and review custom runs retain their scoped instructions and read-only tools", async (t) => {
  const f = await fixture(t);
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start();
  t.after(() => wrapper.destroy());
  await wrapper.send({ type: "set_plan_mode", phase: "planning" });
  await f.session.sendCustomMessage(custom("Continue planning"), { triggerTurn: true });
  assert.equal(f.requests.length, 1);
  assert.equal(count(f.requests[0].systemPrompt, progressMarker), 0);
  assert.equal(count(f.requests[0].systemPrompt, PLAN_MODE_SYSTEM_PROMPT), 1);
  assert.deepEqual([...f.requests[0].tools].sort(), ["read", "grep", "find", "ls", "request_user_input"].sort());
  assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "eureka-plan-framing").length, 1);
  await wrapper.send({ type: "submit_plan", content: "# Goal\nReview fixture\n# Implementation steps\n- [ ] Complete fixture\n# Verification\n- [ ] Verify fixture" });
  await f.session.sendCustomMessage(custom("Review only"), { triggerTurn: true });
  assert.equal(count(f.requests[1].systemPrompt, progressMarker), 0);
  assert.equal(count(f.requests[1].systemPrompt, PLAN_MODE_SYSTEM_PROMPT), 1);
  assert.deepEqual([...f.requests[1].tools].sort(), ["read", "grep", "find", "ls"].sort());
  assert.deepEqual(f.errors, []);
});

test("automation authoring instructions remain scoped to the bound task for both trigger types", async (t) => {
  const f = await fixture(t);
  const task = await authorIdentity(t);
  bindAutomationTask(f.manager, { version: 1, task, sessionId: f.manager.getSessionId(), status: "active", goal: "Fixture only", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  t.after(() => bindAutomationTask(f.manager, null));
  await f.session.prompt("Author a fixture");
  await f.session.sendCustomMessage(custom("Continue authoring"), { triggerTurn: true });
  for (const request of f.requests) {
    assert.equal(count(request.systemPrompt, AUTOMATION_AUTHOR_SYSTEM), 1);
    assert.equal(count(request.systemPrompt, progressMarker), 1);
  }
  bindAutomationTask(f.manager, null);
  await f.session.prompt("Return to ordinary chat");
  assert.ok(!f.requests[2].systemPrompt.includes(AUTOMATION_AUTHOR_SYSTEM));
  assert.ok(!f.requests[2].tools.includes("eureka_app_write"));
  assert.deepEqual(f.errors, []);
});

test("RPC automation completion restores tools without writing the SDK's read-only prompt", async (t) => {
  const f = await fixture(t);
  const task = await authorIdentity(t);
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start();
  t.after(() => wrapper.destroy());
  await wrapper.send({ type: "prompt", message: "Author a local fixture", automationTask: task });
  await f.session.waitForIdle();
  await tick();
  assert.equal(count(f.requests[0].systemPrompt, AUTOMATION_AUTHOR_SYSTEM), 1);
  assert.equal(activeAutomationTask(f.manager), undefined);
  assert.ok(f.session.getActiveToolNames().includes("read"));
  await wrapper.send({ type: "prompt", message: "Independent ordinary task" });
  await f.session.waitForIdle();
  await tick();
  assert.ok(!f.requests[1].systemPrompt.includes(AUTOMATION_AUTHOR_SYSTEM));
  assert.deepEqual(f.errors, []);
});

test("approved plan follow-ups do not repeat startup framing or leak into the next task", async (t) => {
  const f = await fixture(t, { respond: (number) => number === 2 ? [1, 2].map((taskIndex) => ({ type: "toolCall", id: `mark-${taskIndex}`, name: "mark_plan_done", arguments: { taskIndex } })) : text("Fixture response") });
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start();
  t.after(() => wrapper.destroy());
  await approvePlan(wrapper);
  await wrapper.send({ type: "execute_plan" });
  await f.session.waitForIdle();
  await tick();
  assert.equal(f.requests.length, 3);
  assert.equal(f.starts.length, 1);
  assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "eureka-plan-execution-framing").length, 1);
  assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "eureka-plan-execution-continue").length, 1);
  await wrapper.send({ type: "prompt", message: "Independent next task" });
  await f.session.waitForIdle();
  await tick();
  assert.equal(f.requests.length, 4);
  assert.equal(f.starts.length, 2);
  assert.ok(!f.session.getActiveToolNames().includes("mark_plan_done"));
  assert.ok(!f.requests[3].systemPrompt.includes(PLAN_MODE_SYSTEM_PROMPT));
  assert.deepEqual(f.errors, []);
});

test("aborted approved plans cannot enqueue another automatic execution turn", async (t) => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, { before: async () => { entered.resolve(); await release.promise; } });
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start();
  t.after(() => wrapper.destroy());
  await approvePlan(wrapper);
  const pending = wrapper.send({ type: "execute_plan" });
  await entered.promise;
  const abort = wrapper.send({ type: "abort" });
  release.resolve();
  await Promise.all([pending, abort]);
  await tick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "eureka-plan-execution-continue").length, 0);
  assert.equal((await wrapper.send({ type: "get_plan_mode" })).phase, "idle");
  assert.deepEqual(f.errors, []);
});
