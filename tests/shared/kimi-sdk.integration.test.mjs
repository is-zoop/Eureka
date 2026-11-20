import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createCompatibleModelRuntime, normalizeKimiCodingRequestModel } = await jiti.import("../../server/models/model-runtime-compat.ts");

test("Kimi normalization targets only the official legacy OpenAI endpoint", () => {
  const model = { provider: "kimi-coding", api: "openai-completions", baseUrl: "https://api.kimi.com/coding///?test=1" };
  assert.equal(normalizeKimiCodingRequestModel(model).baseUrl, "https://api.kimi.com/coding/v1?test=1");
  for (const patch of [{ api: "anthropic-messages" }, { provider: "custom-kimi" }, { baseUrl: "https://gateway.example/coding" }, { baseUrl: "https://api.kimi.com/coding/v1" }, { baseUrl: "http://api.kimi.com/coding" }]) {
    const input = { ...model, ...patch };
    assert.equal(normalizeKimiCodingRequestModel(input), input);
  }
});

test("Kimi request compatibility does not refresh or replace extension providers and survives refresh", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-kimi-dispatch-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(join(dir, "auth.json"), "{}");
  const runtime = await createCompatibleModelRuntime({ authPath: join(dir, "auth.json"), modelsPath: null, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false });
  let requested;
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  runtime.registerProvider("kimi-coding", { api: "openai-completions", baseUrl: "https://api.kimi.com/coding", apiKey: "fixture-key", streamSimple: (model) => {
    requested = model;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }));
    return stream;
  } });
  const { restoreKimiCodingCompatibility } = await jiti.import("../../server/models/model-runtime-compat.ts");
  t.mock.method(runtime, "registerNativeProvider", () => { throw new Error("Must preserve user extension provider"); });
  restoreKimiCodingCompatibility(runtime);
  await runtime.refresh({ allowNetwork: false });
  const result = await runtime.completeSimple(runtime.getModels("kimi-coding")[0], { messages: [{ role: "user", content: "Fixture", timestamp: Date.now() }] });
  assert.equal(result.stopReason, "stop");
  assert.equal(requested.baseUrl, "https://api.kimi.com/coding/v1");
});

for (const variant of [
  { name: "default OpenAI protocol and official legacy address", config: { baseUrl: "https://api.kimi.com/coding" }, path: "https://api.kimi.com/coding/v1/chat/completions", api: "openai-completions" },
  { name: "custom OpenAI gateway", config: { baseUrl: "https://kimi-gateway.invalid/custom/v1", api: "openai-completions" }, path: "https://kimi-gateway.invalid/custom/v1/chat/completions", api: "openai-completions" },
  { name: "explicit legacy Anthropic gateway", config: { baseUrl: "https://kimi-gateway.invalid/coding", api: "anthropic-messages" }, path: "https://kimi-gateway.invalid/coding/v1/messages?beta=true", api: "anthropic-messages" },
]) test(`Kimi ${variant.name} sends the expected protocol and tool schema without rewriting files`, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-kimi-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const authPath = join(dir, "auth.json"), modelsPath = join(dir, "models.json");
  await writeFile(authPath, "{}");
  const json = JSON.stringify({ providers: { "kimi-coding": { ...variant.config, apiKey: "fixture-key", models: [{ id: "fixture", api: variant.api }] } } });
  await writeFile(modelsPath, json);
  const runtime = await createCompatibleModelRuntime({ authPath, modelsPath, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false });
  assert.equal(runtime.getError(), undefined);
  let request;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body) };
    const events = variant.api === "anthropic-messages"
      ? 'event: message_start\ndata: {"type":"message_start","message":{"id":"fixture","role":"assistant","content":[],"model":"fixture","usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
    return new Response(events, { headers: { "content-type": "text/event-stream" } });
  });
  const result = await runtime.completeSimple(runtime.getModel("kimi-coding", "fixture"), {
    messages: [{ role: "user", content: "fixture", timestamp: Date.now() }],
    tools: [{ name: "fixture_tool", description: "Fixture tool", parameters: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] } }],
  }, { maxTokens: 16, maxRetries: 0 });
  assert.notEqual(result.stopReason, "error", result.errorMessage);
  assert.equal(request.url, variant.path);
  assert.equal(request.body.model, "fixture");
  assert.equal(variant.api === "anthropic-messages" ? request.body.tools[0].name : request.body.tools[0].function.name, "fixture_tool");
  assert.equal(await readFile(modelsPath, "utf8"), json);
  assert.equal(await readFile(authPath, "utf8"), "{}");
  if (variant.api === "openai-completions") {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
    const { POST } = await jiti.import("../../app/api/models-config/test/route.ts");
    const response = await POST(new Request("http://localhost/api/models-config/test", {
      method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
      body: JSON.stringify({ providerName: "kimi-coding", provider: { ...variant.config, apiKey: "fixture-key" }, model: { id: "fixture", api: variant.api } }),
    }));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true, data.error);
    assert.equal(data.responseText, "OK");
    assert.equal(request.url, variant.path);
    if (variant.config.baseUrl === "https://api.kimi.com/coding") {
      const toolSchema = { name: "fixture_tool", description: "Fixture", parameters: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] } };
      const messages = [{ role: "user", content: "Call fixture", timestamp: Date.now() }];
      const transport = globalThis.fetch;
      t.mock.method(globalThis, "fetch", async () => new Response('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-fixture","type":"function","function":{"name":"fixture_tool","arguments":"{\\"count\\":2}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
      const call = await runtime.completeSimple(runtime.getModel("kimi-coding", "fixture"), { messages, tools: [toolSchema] }, { maxTokens: 16, maxRetries: 0 });
      assert.equal(call.stopReason, "toolUse", call.errorMessage);
      assert.deepEqual(call.content.find((block) => block.type === "toolCall").arguments, { count: 2 });
      t.mock.method(globalThis, "fetch", transport);
      const completed = await runtime.completeSimple(runtime.getModel("kimi-coding", "fixture"), { tools: [toolSchema], messages: [...messages, call, { role: "toolResult", toolCallId: "call-fixture", toolName: "fixture_tool", content: [{ type: "text", text: "2" }], isError: false, timestamp: Date.now() }] }, { maxTokens: 16, maxRetries: 0 });
      assert.equal(completed.stopReason, "stop", completed.errorMessage);
      assert.ok(request.body.messages.some((message) => message.role === "tool" && message.tool_call_id === "call-fixture"));
    }
  }
});
