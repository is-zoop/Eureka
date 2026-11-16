import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpExtension, createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { McpClient } from "@earendil-works/pi-mcp";
import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";

async function serverFixture(t) {
  const pair = createInMemoryTransportPair();
  const calls = [], notifications = [];
  pair.server.onMessage(async (message) => {
    if (message.id === undefined) { notifications.push(message); return; }
    let result;
    switch (message.method) {
      case "initialize": result = { protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fixture", version: "1" } }; break;
      case "tools/list": result = { tools: [{ name: "echo", description: "Echo fixture count", inputSchema: { type: "object", properties: { count: { type: "integer", minimum: 1 } }, required: ["count"], additionalProperties: false } }] }; break;
      case "tools/call":
        calls.push(message.params);
        if (message.params.arguments.count === 99) return;
        result = { content: [{ type: "text", text: `count=${message.params.arguments.count}` }], structuredContent: { count: message.params.arguments.count } }; break;
      case "resources/list": result = { resources: [{ uri: "fixture://data", name: "Fixture data" }] }; break;
      case "resources/templates/list": result = { resourceTemplates: [] }; break;
      case "resources/read": result = { contents: [{ uri: "fixture://data", mimeType: "text/plain", text: "Fixture resource" }] }; break;
      default: result = {};
    }
    await pair.server.send({ jsonrpc: "2.0", id: message.id, result });
  });
  await pair.server.start();
  t.after(() => pair.server.close());
  return { ...pair, calls, notifications };
}

test("native MCP client negotiates, calls tools, reads resources and cancels pending requests", async (t) => {
  const f = await serverFixture(t);
  const client = new McpClient({ name: "eureka-fixture", version: "1", requestTimeoutMs: 2000 });
  t.after(() => client.close());
  await client.connect(f.client);
  assert.equal(client.protocolVersion, "2025-11-25");
  assert.equal((await client.listTools())[0].name, "echo");
  assert.deepEqual((await client.callTool("echo", { count: 2 })).structuredContent, { count: 2 });
  assert.equal((await client.listResources())[0].uri, "fixture://data");
  assert.equal((await client.readResource("fixture://data")).contents[0].text, "Fixture resource");
  const abort = new AbortController();
  const pending = client.callTool("echo", { count: 99 }, { signal: abort.signal });
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.notifications.some((message) => message.method === "notifications/cancelled"));
});

for (const denied of [false, true]) test(`native MCP direct tools use real SDK validation and ${denied ? "respect denial before outbound call" : "return structured results"}`, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-native-mcp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  await writeFile(join(dir, "auth.json"), "{}");
  const f = await serverFixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("mcp-fixture", { api: "openai-completions", baseUrl: "https://unused.invalid/v1", apiKey: "fixture", models: [{ id: "fixture", name: "Fixture", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 64, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const requests = [], hooks = [];
  runtime.registerNativeProvider({ ...runtime.getProvider("mcp-fixture"), streamSimple: (_model, context) => {
    requests.push(context);
    const first = requests.length === 1;
    const content = first ? [{ type: "toolCall", id: "fixture-call", name: "mcp__fixture__echo", arguments: { count: "2" } }] : [{ type: "text", text: "Done" }];
    const stopReason = first ? "toolUse" : "stop";
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: { role: "assistant", provider: "mcp-fixture", model: "fixture", api: "openai-completions", content, stopReason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }));
    return stream;
  } });
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }), resourceLoaderOptions: {
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [
      { name: "native-mcp-fixture", factory: createMcpExtension({ loadConfig: () => ({ servers: [{ name: "fixture", config: { command: "unused", exposure: "direct" }, source: "fixture", scope: "extension" }], errors: [], autoEnableCodemode: false }), createTransport: () => f.client, logPath: join(dir, "mcp.log") }) },
      { name: "permission-fixture", factory: (pi) => pi.on("tool_call", (event) => { hooks.push(event); if (denied) return { block: true, reason: "Fixture permission denied" }; }) },
    ],
  } });
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: runtime.getModel("mcp-fixture", "fixture") });
  t.after(() => session.dispose());
  const errors = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  await session.prompt("Call fixture echo");
  assert.ok(getCurrentTools(requests[0].messages).some((tool) => tool.name === "mcp__fixture__echo"));
  assert.equal(hooks.length, 1);
  const result = session.agent.state.messages.find((message) => message.role === "toolResult");
  assert.ok(result);
  if (denied) { assert.equal(f.calls.length, 0); assert.equal(result.isError, true); }
  else { assert.deepEqual(f.calls[0].arguments, { count: 2 }); assert.match(JSON.stringify(result), /count=2/); }
  assert.deepEqual(errors, []);
});

for (const exposure of ["deferred", "hidden"]) test(`native ${exposure} tools respect search exposure before invoking the MCP`, async t => {
  const { createToolSearchExtension } = await import("@earendil-works/pi-coding-agent");
  const dir = await mkdtemp(join(tmpdir(), "eureka-mcp-search-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  await writeFile(join(dir, "auth.json"), "{}");
  const f = await serverFixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("search-fixture", { api: "openai-completions", baseUrl: "https://unused.invalid/v1", apiKey: "fixture", models: [{ id: "fixture", name: "Fixture", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 64, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const requests = [];
  runtime.registerNativeProvider({ ...runtime.getProvider("search-fixture"), streamSimple: (_model, context) => {
    requests.push(getCurrentTools(context.messages).map(tool => tool.name));
    const index = requests.length;
    const content = index === 1 ? [{ type: "toolCall", id: "search", name: "tool_search", arguments: { query: "echo" } }] : index === 2 && exposure === "deferred" ? [{ type: "toolCall", id: "echo", name: "mcp__fixture__echo", arguments: { count: 2 } }] : [{ type: "text", text: "Done" }];
    const stopReason = content[0].type === "toolCall" ? "toolUse" : "stop", stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: { role: "assistant", provider: "search-fixture", model: "fixture", api: "openai-completions", content, stopReason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }));
    return stream;
  } });
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
    { name: "search", factory: createToolSearchExtension() },
    { name: "mcp", factory: createMcpExtension({ loadConfig: () => ({ servers: [{ name: "fixture", config: { command: "unused", exposure }, source: "fixture", scope: "extension" }], errors: [], autoEnableCodemode: false }), createTransport: () => f.client, logPath: join(dir, "mcp.log") }) },
  ] } });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: runtime.getModel("search-fixture", "fixture") });
  t.after(() => session.dispose()); await session.bindExtensions({ mode: "rpc" });
  await session.prompt("Search and call echo if available");
  assert.ok(!requests[0].includes("mcp__fixture__echo"));
  assert.equal(requests[1].includes("mcp__fixture__echo"), exposure === "deferred");
  assert.equal(f.calls.length, exposure === "deferred" ? 1 : 0);
});
