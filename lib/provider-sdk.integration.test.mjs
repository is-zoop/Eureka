import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { collectProviderListingInputs } = await jiti.import("./provider-listing-runtime.ts");
const { buildApiKeyProviderList, buildOAuthProviderList } = await jiti.import("./provider-listing.ts");
const { createCompatibleModelRuntime, restoreLegacyAzureProvider } = await jiti.import("./model-runtime-compat.ts");
const { createProviderLoginOptions } = await jiti.import("./provider-login.ts");
const { installNativeMcpRuntime } = await jiti.import("./native-mcp-runtime.ts");

async function fixture(t, credentials = {}) {
  const dir = await mkdtemp(join(tmpdir(), "eureka-provider-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, JSON.stringify(credentials));
  return { dir, authPath, options: { authPath, modelsPath: null, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false } };
}

test("SDK provider picker includes Meta, TypeSafe, Azure and ChatGPT OAuth with usable catalogs", async (t) => {
  const { options } = await fixture(t);
  const runtime = await ModelRuntime.create(options);
  const inputs = await collectProviderListingInputs(runtime);
  const apiKeys = buildApiKeyProviderList(inputs);
  const oauth = buildOAuthProviderList(inputs);
  for (const id of ["meta", "typesafe", "azure", "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual"]) {
    assert.ok(apiKeys.find((provider) => provider.id === id)?.modelCount > 0, id);
  }
  for (const id of ["meta", "openai"]) {
    assert.equal(oauth.find((provider) => provider.id === id)?.supportsApiKey, true, id);
  }
  assert.ok(runtime.getModels("meta").length > 0);
  assert.equal(runtime.getModels("typesafe").length, 0, "classifiers must stay out of the chat selector");
  assert.ok(runtime.getModelsOfType("classifier", "typesafe").length > 0);
});

test("legacy Azure credentials remain usable without rewriting auth.json or duplicating fresh catalogs", async (t) => {
  const id = "azure-openai-responses";
  const { authPath, options } = await fixture(t, { [id]: { type: "api_key", key: "test-azure-key" } });
  const before = await readFile(authPath, "utf8");
  const runtime = await createCompatibleModelRuntime(options);
  assert.ok(runtime.getModels(id).length > 0);
  assert.ok(runtime.getModels(id).every((model) => model.provider === id));
  assert.equal((await runtime.getAuth(id)).auth.apiKey, "test-azure-key");
  assert.ok((await runtime.getAvailable(id)).length > 0);
  assert.equal(await readFile(authPath, "utf8"), before);

  const fresh = await fixture(t);
  const cleanRuntime = await createCompatibleModelRuntime(fresh.options);
  assert.equal(cleanRuntime.getProvider(id), undefined);
  await restoreLegacyAzureProvider(cleanRuntime, SettingsManager.inMemory({ defaultProvider: id }));
  assert.ok(cleanRuntime.getProvider(id), "saved provider references restore the compatibility provider");
});

test("ChatGPT login creates a persistent Pi device ID while preserving other settings", async (t) => {
  const { dir } = await fixture(t);
  await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "anthropic", defaultModel: "existing-model" }));
  const first = createProviderLoginOptions(dir);
  const deviceId = first.options.getDeviceId();
  assert.ok(deviceId.length > 0);
  await first.flush();
  const second = createProviderLoginOptions(dir);
  assert.equal(second.options.getDeviceId(), deviceId);
  await second.flush();
  const settings = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
  assert.equal(settings.defaultModel, "existing-model");
  assert.equal(settings.defaultProvider, "anthropic");
});

test("native MCP loads once with its SDK search and Codemode tools and no legacy proxy", { timeout: 60_000 }, async (t) => {
  const { dir, options } = await fixture(t);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const runtime = await ModelRuntime.create(options);
  const services = await createAgentSessionServices({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [installNativeMcpRuntime],
    },
  });
  const loaded = services.resourceLoader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
  assert.ok(!tools.includes("mcp"), JSON.stringify(tools));
  assert.equal(tools.filter((name) => name === "codemode").length, 1);
  assert.equal(tools.filter((name) => name === "tool_search").length, 1);
  assert.equal(loaded.extensions.flatMap((extension) => [...extension.commands.keys()]).filter((name) => name === "mcp").length, 1);
  assert.ok(!loaded.extensions.some((extension) => extension.path === "builtin:mcp"));
});

test("SDK sessions prompt, compact, navigate and fork local session history without network calls", async (t) => {
  const { dir, options } = await fixture(t);
  const runtime = await ModelRuntime.create(options);
  runtime.registerProvider("sdk-test", {
    baseUrl: "https://unused.invalid/v1", api: "openai-responses", apiKey: "fixture-key",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const model = runtime.getModel("sdk-test", "fixture");
  let calls = 0;
  const respond = () => {
    calls++;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: `Fixture response ${calls}` }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 25, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }));
    return stream;
  };
  runtime.registerNativeProvider({ ...runtime.getProvider("sdk-test"), stream: respond, streamSimple: respond });
  await runtime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1024 } });
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: settings,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model, tools: [] });
  t.after(() => session.dispose());
  const events = [];
  session.subscribe((event) => events.push(event.type));
  const accepted = [];
  await session.prompt("First local prompt", { preflightResult: (disposition) => accepted.push(disposition) });
  const firstLeaf = manager.getLeafId();
  await session.prompt("Second local prompt");
  assert.deepEqual(accepted, ["started"]);
  assert.equal(calls, 2);
  assert.ok(events.includes("agent_start") && events.includes("agent_end"));
  assert.deepEqual(session.getActiveToolNames(), []);
  await session.compact("Keep the important details");
  assert.ok(events.includes("compaction_start") && events.includes("compaction_end"));
  assert.ok(manager.getEntries().some((entry) => entry.type === "compaction"));
  await session.navigateTree(firstLeaf, { summarize: false });
  assert.equal(manager.getLeafId(), firstLeaf);
  const originalId = manager.getSessionId();
  const forkPath = manager.createBranchedSession(firstLeaf);
  assert.ok(forkPath);
  assert.notEqual(manager.getSessionId(), originalId);
  const saved = SessionManager.open(forkPath);
  assert.ok(saved.getBranch().some((entry) => entry.type === "message" && entry.message.role === "assistant"));
});
