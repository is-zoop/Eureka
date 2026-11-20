import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";
import { fixtureZip, pluginFiles } from "../extensions/fixtures/haze-plugin-fixture.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { installNativeMcpRuntime } = await jiti.import("../../server/mcp/native-mcp-runtime.ts");
const { installHazeManagedMcpRuntime } = await jiti.import("../../server/mcp/haze-mcp-runtime.ts");
const auth = await jiti.import("../../lib/auth/runtime-session.ts");
const registry = await jiti.import("../../server/extensions/haze-registry.ts");
const { parsePluginArchive } = await jiti.import("../../server/extensions/haze-plugin-package.ts");
const { pluginMcpName } = await jiti.import("../../server/extensions/haze-plugin-resources.ts");
const { ClarificationRuntime } = await jiti.import("../../server/agent/clarification-runtime.ts");
const { EUREKA_PROMPT_POLICY_EXTENSION, setSessionPromptSuppressed } = await jiti.import("../../server/agent/session-prompt-policy.ts");
const { installMcpStatusRuntime, getMcpRuntime } = await jiti.import("../../server/mcp/mcp-runtime.ts");
const { installPluginBrowserHandoff } = await jiti.import("../../server/extensions/plugin-browser.ts");

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "eureka-native-haze-"));
  const state = { key: "fixture-personal-one", access: "fixture-access", refresh: "fixture-seed", rotations: 0, credentials: 0, requests: [], calls: [], resources: 0, delayCredential: null, delayResult: null, redirect: false, browser: false };
  let session, controller, previous, issuer;
  const server = createServer(async (req, res) => {
    const json = (status, value, extra = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...extra }); res.end(JSON.stringify(value)); };
    if (req.url === "/api/oauth/token") {
      let body = ""; for await (const part of req) body += part;
      if (new URLSearchParams(body).get("refresh_token") !== state.refresh) return json(400, { error: "invalid_grant" });
      state.rotations++; state.refresh = `fixture-refresh-${state.rotations}`;
      return json(200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600 });
    }
    if (req.url === "/api/auth/me/mcp-credential") {
      if (req.headers.authorization !== `Bearer ${state.access}`) return json(401, {});
      state.credentials++;
      if (state.delayCredential) { state.credentialEntered?.(); await state.delayCredential; }
      return json(200, { data: { key: state.key } });
    }
    if (req.url === "/redirect-target") { state.leakedRedirect = true; return json(200, {}); }
    if (req.url !== "/mcp") return json(404, {});
    if (req.headers.authorization !== `Bearer ${state.key}`) return json(401, {});
    if (state.redirect) return json(302, {}, { Location: `${issuer}/redirect-target` });
    if (req.method === "GET" || req.method === "DELETE") { res.writeHead(405); return res.end(); }
    let body = ""; for await (const part of req) body += part;
    const message = JSON.parse(body); state.requests.push(message.method);
    if (message.id === undefined) { res.writeHead(202); return res.end(); }
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "haze-fixture", version: "1" } };
    else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Fixture echo", inputSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] } }] };
    else if (message.method === "tools/call") {
      state.calls.push({ authorization: req.headers.authorization, arguments: message.params.arguments });
      if (state.delayResult) { state.resultEntered?.(); res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); await state.delayResult; return res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "PRIVATE-LATE-RESULT" }] } })}\n\n`); }
      result = state.browser ? { content: [], structuredContent: { data: { session_id: "fixture-session", browser_url: `${issuer}/selection?token=fixture-launch-secret` }, request_id: "fixture-request" } } : { content: [{ type: "text", text: `count=${message.params.arguments.count}` }], structuredContent: { count: message.params.arguments.count } };
    }
    else if (message.method === "resources/list") { state.resources++; result = { resources: [{ uri: "fixture://data", name: "Fixture" }] }; }
    else if (message.method === "resources/templates/list") result = { resourceTemplates: [] };
    else if (message.method === "resources/read") { state.resources++; result = { contents: [{ uri: "fixture://data", mimeType: "text/plain", text: "Fixture resource" }] }; }
    else result = {};
    json(200, { jsonrpc: "2.0", id: message.id, result });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  issuer = `http://127.0.0.1:${server.address().port}`;
  const env = { PI_CODING_AGENT_DIR: root, EUREKA_AUTH_HAZE_ISSUER: issuer, EUREKA_AUTH_CLIENT_ID: "fixture", EUREKA_AUTH_REDIRECT_URI: "http://localhost/callback", EUREKA_AUTH_SESSION_SECRET: "fixture-native-haze-test-secret-32-characters", EUREKA_NATIVE_FIXTURE_TOKEN: state.key };
  previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]])); Object.assign(process.env, env);
  t.after(async () => {
    if (!state.skipShutdown) await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "exit" }); session?.dispose(); controller?.dispose();
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const identity = await auth.writeRuntimeHazeSession({ principal: { subject: "user-a", permissions: [] }, providerId: "haze-oidc", refreshToken: state.refresh, expiresAt: 0 });
  const files = pluginFiles({ url: `${issuer}/mcp`, composer: { selectionMode: "persistent" } });
  const pkg = parsePluginArchive(fixtureZip(files), "2.1.0");
  const pluginRoot = join(root, "plugins", "fixture");
  for (const [name, bytes] of pkg.files) { const path = join(pluginRoot, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  const item = { capabilityId: "42", name: "Atlas", type: "Plugin", version: "2.1.0", scope: "global", installedAt: new Date().toISOString(), plugin: { source: issuer, subject: "user-a", digest: "fixture-digest", root: pluginRoot, manifest: pkg.manifest, approvedUrls: [`${issuer}/mcp`] } };
  await registry.writeHazeRegistry(root, "global", { version: 1, installs: [item] });
  if (options.exposure) await registry.writeHazeRegistry(root, "global", { version: 1, installs: [item, { capabilityId: "43", name: "standalone", type: "MCP", version: "1", scope: "global", installedAt: new Date().toISOString(), serverUrl: `${issuer}/mcp`, exposure: options.exposure }] });
  if (options.manual) {
    const { mutateMcpServers } = await jiti.import("../../server/mcp/mcp-config.ts");
    await mutateMcpServers(root, "global", "create", { name: "manual_fixture", transport: "http", url: `${issuer}/mcp`, bearerTokenEnv: "EUREKA_NATIVE_FIXTURE_TOKEN" });
  }
  await writeFile(join(root, "auth.json"), "{}");
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models-store.json"), refreshOnCreate: false });
  runtime.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://unused.invalid/v1", apiKey: "fixture-key", models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  let tool, argumentsValue, requested = false;
  const providerRequests = [], browserCalls = [];
  runtime.registerNativeProvider({ ...runtime.getProvider("fixture"), streamSimple: (_model, context) => {
    providerRequests.push(context);
    const content = requested ? [{ type: "text", text: "Done" }] : [{ type: "toolCall", id: `fixture-${providerRequests.length}`, name: tool, arguments: argumentsValue }];
    const stopReason = requested ? "stop" : "toolUse"; requested = true;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: { role: "assistant", provider: "fixture", model: "fixture", api: "openai-completions", content, stopReason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } })); return stream;
  } });
  const services = await createAgentSessionServices({ cwd: root, agentDir: root, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }), resourceLoaderOptions: {
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [installHazeManagedMcpRuntime, installNativeMcpRuntime, (pi) => installPluginBrowserHandoff(pi, async (...args) => { browserCalls.push(args); return { tabId: "fixture-tab" }; }), installMcpStatusRuntime, EUREKA_PROMPT_POLICY_EXTENSION],
  } });
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(root);
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: runtime.getModel("fixture", "fixture") }));
  controller = new ClarificationRuntime(manager, () => {});
  const selected = { source: issuer, subject: "user-a", capabilityId: "42", digest: "fixture-digest" };
  controller.task = { id: "fixture-task", clarificationEnabled: false, plugins: [selected], owner: { source: issuer, subject: "user-a" } };
  const errors = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  const serverName = pluginMcpName(item, "atlas");
  const run = async (name = `mcp__${serverName}__echo`, args = { count: "2" }) => {
    tool = name; argumentsValue = args; requested = false;
    await session.prompt("Fixture MCP request");
    return session.agent.state.messages.findLast((message) => message.role === "toolResult");
  };
  return { state, root, issuer, identity, session, controller, selected, serverName, run, errors, providerRequests, browserCalls, item, setSuppressed: (value) => setSessionPromptSuppressed(manager, value), status: () => getMcpRuntime(manager.getSessionId()) };
}

test("native Haze MCP refreshes OAuth, rotates the personal key per request and completes real Agent calls/resources", async (t) => {
  const f = await fixture(t);
  assert.match(JSON.stringify(await f.run()), /count=2/);
  assert.equal(f.state.rotations, 1);
  assert.deepEqual(f.state.calls[0].arguments, { count: 2 });
  f.state.key = "fixture-personal-two";
  assert.equal((await f.run()).isError, false);
  assert.equal(f.state.calls.at(-1).authorization, "Bearer fixture-personal-two");
  const resource = await f.run("read_mcp_resource", { server: f.serverName, uri: "fixture://data" });
  assert.equal(resource.isError, false, JSON.stringify(resource));
  assert.match(JSON.stringify(resource), /Fixture resource/);
  assert.equal(f.status().servers.find((server) => server.name === f.serverName).state, "connected");
  assert.deepEqual(f.errors, []);
  assert.doesNotMatch(await readFile(registry.registryPath(f.root, "global"), "utf8"), /fixture-personal/);
  assert.doesNotMatch(JSON.stringify(f.session.sessionManager.getEntries()), /fixture-personal|fixture-refresh|fixture-access/);
});

test("managed Haze MCP deferred exposure uses native search and retains per-request credential authorization", async t => {
  const f = await fixture(t, { exposure: "deferred" });
  const result = await f.run("tool_search", { query: "standalone echo" });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.ok(!getCurrentTools(f.providerRequests[0].messages).some(tool => tool.name === "mcp__standalone__echo"));
  assert.ok(getCurrentTools(f.providerRequests.at(-1).messages).some(tool => tool.name === "mcp__standalone__echo"));
  assert.equal((await f.run("mcp__standalone__echo")).isError, false);
  assert.equal(f.state.calls.at(-1).authorization, `Bearer ${f.state.key}`);
  const credentials = f.state.credentials, calls = f.state.calls.length;
  const records = registry.readHazeRegistry(f.root, "global"); records.installs.find(item => item.capabilityId === "43").disabled = true;
  await registry.writeHazeRegistry(f.root, "global", records);
  assert.equal((await f.run("mcp__standalone__echo")).isError, true);
  assert.equal(f.state.credentials, credentials); assert.equal(f.state.calls.length, calls);
});

test("deselection, disabled tools and removed URL approval block outbound Haze tools and resources", async (t) => {
  const f = await fixture(t); await f.run();
  const calls = f.state.calls.length, credentials = f.state.credentials;
  f.controller.task = { ...f.controller.task, plugins: [] };
  assert.equal((await f.run()).isError, true);
  assert.equal((await f.run("read_mcp_resource", { server: f.serverName, uri: "fixture://data" })).isError, true);
  assert.equal(f.state.calls.length, calls); assert.equal(f.state.credentials, credentials);
  f.controller.task = { ...f.controller.task, plugins: [f.selected] };
  f.setSuppressed(true); await f.run(); f.setSuppressed(false);
  assert.equal(f.state.calls.length, calls);
  await registry.writeHazeRegistry(f.root, "global", { version: 1, installs: [{ ...f.item, plugin: { ...f.item.plugin, approvedUrls: [] } }] });
  assert.equal((await f.run()).isError, true); assert.equal(f.state.calls.length, calls);
});

test("account changes while fetching credentials prevent dispatch, and redirects never receive the key", async (t) => {
  const f = await fixture(t); await f.run();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.state.delayCredential = release.promise; f.state.credentialEntered = entered.resolve;
  const calls = f.state.calls.length;
  const pending = f.run(); await entered.promise;
  await auth.writeRuntimeHazeSession({ principal: { subject: "user-b", permissions: [] }, providerId: "haze-oidc", accessToken: f.state.access, refreshToken: f.state.refresh, expiresAt: Date.now() + 3600000 });
  release.resolve();
  assert.equal((await pending).isError, true); assert.equal(f.state.calls.length, calls);
  assert.equal(f.status().servers[0].state, "needs-auth");
});

test("logout discards late SSE tool results instead of exposing the previous account's data", async (t) => {
  const f = await fixture(t); await f.run();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.state.delayResult = release.promise; f.state.resultEntered = entered.resolve;
  const pending = f.run(); await entered.promise;
  await auth.clearRuntimeHazeSession(); release.resolve();
  assert.equal((await pending).isError, true);
  assert.doesNotMatch(JSON.stringify(f.providerRequests.at(-1)), /PRIVATE-LATE-RESULT/);
});

test("native structured browser results open the panel once and redact launch URLs from both outputs", async (t) => {
  const f = await fixture(t); f.state.browser = true;
  const result = await f.run();
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(f.browserCalls.length, 1);
  assert.match(JSON.stringify(result), /fixture-tab/);
  assert.doesNotMatch(JSON.stringify(f.session.sessionManager.getEntries()), /fixture-launch-secret|browser_url/);
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "codemode"]);
  const scripted = await f.run("codemode", { code: `console.log(await tools.mcp__${f.serverName}__echo({count: 2}));` });
  assert.equal(scripted.isError, false, JSON.stringify(scripted));
  assert.equal(f.browserCalls.length, 2);
  assert.doesNotMatch(JSON.stringify(f.session.sessionManager.getEntries()), /fixture-launch-secret|browser_url/);
});

test("Haze MCP rejects redirects and cancellation during credential resolution before outbound calls", async (t) => {
  const f = await fixture(t); await f.run(); const calls = f.state.calls.length;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.state.delayCredential = release.promise; f.state.credentialEntered = entered.resolve;
  const pending = f.run(); await entered.promise;
  const abort = f.session.abort(); release.resolve(); await Promise.all([pending, abort]);
  assert.equal(f.state.calls.length, calls);
  f.state.delayCredential = null; f.state.redirect = true;
  assert.equal((await f.run()).isError, true);
  assert.equal(f.state.leakedRedirect, undefined);
});

test("native Codemode reaches Haze through the same credential and task authorization gates", async (t) => {
  const f = await fixture(t); await f.run();
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "codemode"]);
  const code = `const result = await tools.mcp__${f.serverName}__echo({count: 7}); console.log(result);`;
  const result = await f.run("codemode", { code });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(f.state.calls.at(-1).arguments.count, 7);
  const calls = f.state.calls.length;
  f.controller.task = { ...f.controller.task, plugins: [] };
  const denied = await f.run("codemode", { code });
  assert.equal(f.state.calls.length, calls);
  assert.match(JSON.stringify(denied), /选择|NOT SELECTED|not selected|denied/i);
});

test("new settings configurations are consumed by the native SDK and reference credentials through the environment", async (t) => {
  const f = await fixture(t, { manual: true });
  const result = await f.run("mcp__manual_fixture__echo", { count: "3" });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(f.state.calls.at(-1).arguments, { count: 3 });
  const { listMcpServers, mutateMcpServers } = await jiti.import("../../server/mcp/mcp-config.ts");
  const configured = await listMcpServers(f.root, "global");
  assert.equal(configured.servers[0].bearerTokenEnv, "EUREKA_NATIVE_FIXTURE_TOKEN");
  assert.equal(configured.servers[0].timeout, 60);
  assert.doesNotMatch(await readFile(configured.configPath, "utf8"), /fixture-personal/);
  const updated = await mutateMcpServers(f.root, "global", "update", { ...configured.servers[0], timeout: 90 }, "manual_fixture");
  assert.equal(updated.servers[0].timeout, 90);
  await mutateMcpServers(f.root, "global", "set-disabled", undefined, "manual_fixture", true);
  const config = JSON.parse(await readFile(configured.configPath, "utf8"));
  assert.equal(config.mcpServers.manual_fixture.enabled, false);
  assert.equal(config.mcpServers.manual_fixture.disabled, undefined);
});

test("direct wrapper destruction closes native transports and clears the original identity after a fork changes the id", async (t) => {
  const f = await fixture(t); await f.run();
  const { AgentSessionWrapper } = await jiti.import("../../server/agent/rpc-manager.ts");
  const { getHazeNativeMcpBinding } = await jiti.import("../../server/mcp/haze-native-mcp-bindings.ts");
  const original = f.session.sessionId;
  assert.ok(getHazeNativeMcpBinding(original, f.serverName));
  const wrapper = new AgentSessionWrapper(f.session);
  t.mock.method(f.session.sessionManager, "getSessionId", () => "forked-fixture-id");
  f.state.skipShutdown = true;
  wrapper.destroy(); wrapper.destroy();
  assert.equal(getHazeNativeMcpBinding(original, f.serverName), undefined);
  assert.equal(getMcpRuntime(original), null);
  assert.equal(wrapper.isAlive(), false);
});
