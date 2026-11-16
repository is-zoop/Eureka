import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { buildModelsListUrl, parseDiscoveredModels } = await loadSubject("./model-discovery.ts");
const { discoverModelsFromProvider, hasCommandBackedCredentials } = await loadSubject("./model-discovery-client.ts");
const { resolveModelDiscoveryAuth } = await loadSubject("./model-discovery-auth.ts");
const { ModelRuntime } = await loadSubject("@earendil-works/pi-coding-agent");

function setEnvironment(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

async function authFixture(t, credentials = {}) {
  const directory = await mkdtemp(join(tmpdir(), "eureka-discovery-auth-"));
  // Each SDK runtime resolves the normal agent-dir path into this temporary
  // fixture, never the developer's real auth.json or its lock file.
  t.after(() => rm(directory, { recursive: true, force: true }));
  setEnvironment(t, "PI_CODING_AGENT_DIR", directory);
  const authPath = join(directory, "auth.json");
  await writeFile(authPath, JSON.stringify(credentials));
  const create = ModelRuntime.create.bind(ModelRuntime);
  t.mock.method(ModelRuntime, "create", (options) => {
    assert.equal(options.allowModelNetwork, false);
    assert.equal(options.refreshOnCreate, false);
    return create(options);
  });
  return { authPath };
}

test("builds protocol-appropriate model list URLs", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/v1/", "openai-completions").toString(), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages").toString(), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai").toString(), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(buildModelsListUrl("https://api.example.com/custom/models", "openai-responses").toString(), "https://api.example.com/custom/models");
});

test("parses OpenAI, Anthropic, Google, and string model lists", () => {
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5" }, { id: "claude", display_name: "Claude" }] }), [
    { id: "claude", name: "Claude" },
    { id: "gpt-5" },
  ]);
  assert.deepEqual(parseDiscoveredModels({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }] }), [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ]);
  assert.deepEqual(parseDiscoveredModels(["zeta", "alpha", "alpha"]), [
    { id: "alpha" },
    { id: "zeta" },
  ]);
});

test("resolves environment-backed headers without an API key", async (t) => {
  await authFixture(t);
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_TOKEN", "resolved-token");
  const auth = await resolveModelDiscoveryAuth("pi-web-header-only-test", {
    baseUrl: "https://example.invalid/v1",
    api: "openai-completions",
    headers: { "X-Discovery-Token": "$PI_WEB_DISCOVERY_TEST_TOKEN" },
  });
  assert.equal(auth.apiKey, undefined);
  assert.deepEqual(auth.headers, { "X-Discovery-Token": "resolved-token" });
});

test("resolves environment-backed API keys and interpolated headers without refreshing providers", async (t) => {
  await authFixture(t);
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_KEY", "environment-key");
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_TOKEN", "header-token");
  t.mock.method(ModelRuntime.prototype, "refresh", () => { throw new Error("Discovery must not refresh unrelated providers"); });
  const auth = await resolveModelDiscoveryAuth("pi-web-environment-key-test", {
    baseUrl: "https://example.invalid/v1", api: "openai-completions",
    apiKey: "${PI_WEB_DISCOVERY_TEST_KEY}",
    headers: { Authorization: "Bearer ${PI_WEB_DISCOVERY_TEST_TOKEN}", "X-Client": "eureka" },
  });
  assert.equal(auth.apiKey, "environment-key");
  assert.deepEqual(auth.headers, { Authorization: "Bearer header-token", "X-Client": "eureka" });
});

test("stored API keys retain SDK precedence and credential files remain unchanged", async (t) => {
  const name = "pi-web-stored-key-test";
  const { authPath } = await authFixture(t, { [name]: { type: "api_key", key: "stored-fixture-key" } });
  const before = await readFile(authPath, "utf8");
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_KEY", "environment-key");
  const auth = await resolveModelDiscoveryAuth(name, {
    baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "$PI_WEB_DISCOVERY_TEST_KEY",
  });
  assert.equal(auth.apiKey, "stored-fixture-key");
  assert.equal(await readFile(authPath, "utf8"), before);
});

test("discovery sends resolved authentication using each protocol's headers", async (t) => {
  await authFixture(t);
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_KEY", "environment-key");
  for (const [api, header, value] of [
    ["openai-completions", "authorization", "Bearer environment-key"],
    ["anthropic-messages", "x-api-key", "environment-key"],
    ["google-generative-ai", "x-goog-api-key", "environment-key"],
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url.hostname, "example.invalid");
      assert.equal(options.headers.get(header), value);
      assert.equal(options.headers.get("X-Client"), "eureka");
      if (api === "anthropic-messages") assert.equal(options.headers.get("anthropic-version"), "2023-06-01");
      return Response.json({ data: [{ id: "fixture-model" }] });
    });
    try {
      const result = await discoverModelsFromProvider(`pi-web-${api}-test`, {
        baseUrl: "https://example.invalid", api, apiKey: "$PI_WEB_DISCOVERY_TEST_KEY", headers: { "X-Client": "eureka" },
      });
      assert.deepEqual(result.models, [{ id: "fixture-model" }]);
      assert.equal(fetch.mock.callCount(), 1);
      assert.doesNotMatch(JSON.stringify(result), /environment-key/);
    } finally { fetch.mock.restore(); }
  }
});

test("missing environment keys reject discovery before an upstream request", async (t) => {
  await authFixture(t);
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_KEY", undefined);
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("No upstream request expected"); });
  await assert.rejects(discoverModelsFromProvider("pi-web-missing-key-test", {
    baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "$PI_WEB_DISCOVERY_TEST_KEY",
  }), /PI_WEB_DISCOVERY_TEST_KEY|No API key/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("header-only discovery keeps explicit authorization without adding a bearer key", async (t) => {
  await authFixture(t);
  setEnvironment(t, "PI_WEB_DISCOVERY_TEST_TOKEN", "header-token");
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.get("Authorization"), "Token header-token");
    assert.equal(options.headers.get("X-Discovery-Token"), "header-token");
    assert.equal(options.headers.get("x-api-key"), null);
    return Response.json({ data: [{ id: "header-only-model" }] });
  });
  const result = await discoverModelsFromProvider("pi-web-header-only-request-test", {
    baseUrl: "https://example.invalid/v1", api: "openai-completions",
    headers: { Authorization: "Token ${PI_WEB_DISCOVERY_TEST_TOKEN}", "X-Discovery-Token": "$PI_WEB_DISCOVERY_TEST_TOKEN" },
  });
  assert.deepEqual(result.models, [{ id: "header-only-model" }]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(result), /header-token/);
});

test("automatic discovery refuses command-backed credentials", () => {
  assert.equal(hasCommandBackedCredentials({ apiKey: "!read-secret" }), true);
  assert.equal(hasCommandBackedCredentials({ headers: { Authorization: " ! token-command" } }), true);
  assert.equal(hasCommandBackedCredentials({ apiKey: "MODEL_API_KEY", headers: { "X-Client": "pi-web" } }), false);
});
