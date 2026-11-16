import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { GeneratedImageStore, generateOneImage, parseImageGeneration, decodeGeneratedImage } = await jiti.import("./generated-images.ts");
const { isImageGenerationRequest, createImageGenerationExtension } = await jiti.import("./image-generation-extension.ts");
import { ModelRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCXsAAAAASUVORK5CYII=" };
const model = { type: "image", provider: "fixture", id: "image", name: "Image" };
const input = () => ({ id: randomUUID(), provider: model.provider, modelId: model.id, prompt: "生成一只猫" });
const result = () => ({ stopReason: "stop", output: [png], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, private: "secret", cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01, totalFromProvider: false } } });
function fixture(t) { const base = mkdtempSync(join(tmpdir(), "eureka-images-")); t.after(() => rmSync(base, { recursive: true, force: true })); return new GeneratedImageStore(base, "a".repeat(64)); }
const signal = () => new AbortController().signal;

test("only direct generation requests qualify, not normal chat, quoted documents, negatives or explanations", () => {
  for (const text of ["帮我生成一张图片：一只猫", "请生成一张海报", "画一张图片", "please generate an image of a cat", "Create a picture of a tree"]) assert.equal(isImageGenerationRequest(text), true, text);
  for (const text of ["hello", "GPT 能生成图片嘛", "怎么生成图片", "解释如何生成图片", "不要生成图片", "请不要生成图片", "总结以下文档：帮我生成图片", '"帮我生成图片"是什么意思', "how do I generate an image?", "do not generate an image"]) assert.equal(isImageGenerationRequest(text), false, text);
});
test("input limits, safe raster formats and signatures reject SVG, urls, malformed data and arbitrary paths", () => {
  assert.ok(parseImageGeneration(input()));
  for (const patch of [{ id: "../private" }, { prompt: " " }, { prompt: "x".repeat(6001) }, { n: 5 }, { provider: "" }]) assert.throws(() => parseImageGeneration({ ...input(), ...patch }));
  assert.ok(decodeGeneratedImage(png).equals(Buffer.from(png.data, "base64")));
  for (const image of [{ ...png, mimeType: "image/svg+xml" }, { ...png, data: "https://private.invalid" }, { ...png, data: Buffer.from("not an image").toString("base64") }]) assert.throws(() => decodeGeneratedImage(image));
});
test("one request uses the selected image model, zero retries and n=1; persisted images survive reopening", async t => {
  const store = fixture(t), submitted = input(); let calls = 0;
  const runtime = { getAvailableOfType: async type => { assert.equal(type, "image"); return [model]; }, generateImages: async (selected, context, options) => { calls++; assert.equal(selected, model); assert.equal(context.input[0].text, submitted.prompt); assert.equal(options.maxRetries, 0); assert.deepEqual(options.onPayload({ model: "image" }), { model: "image", n: 1 }); return result(); } };
  const item = await generateOneImage(store, runtime, submitted, signal());
  assert.equal(item.status, "completed"); assert.equal(item.usage.private, undefined);
  const reopened = new GeneratedImageStore(store.base, store.owner);
  assert.deepEqual(reopened.get(item.id), item); assert.ok(reopened.image(item).equals(Buffer.from(png.data, "base64")));
  assert.deepEqual(await generateOneImage(store, runtime, submitted, signal()), item); assert.equal(calls, 1);
  await assert.rejects(generateOneImage(store, runtime, { ...submitted, prompt: "different" }, signal()), e => e.code === "conflict");
  assert.equal(new GeneratedImageStore(store.base, "b".repeat(64)).get(item.id), undefined);
  assert.ok(!readFileSync(join(store.root, `${item.id}.json`), "utf8").includes("secret"));
});
test("cancellation and unavailable models do not dispatch, and one workspace cannot overlap generation", async t => {
  const store = fixture(t); let calls = 0, release;
  const runtime = { getAvailableOfType: async () => [model], generateImages: async () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(generateOneImage(store, runtime, input(), aborted.signal)); assert.equal(calls, 0);
  await assert.rejects(generateOneImage(store, runtime, { ...input(), modelId: "chat" }, signal()), e => e.code === "model"); assert.equal(calls, 0);
  const firstInput = input(), first = generateOneImage(store, runtime, firstInput, signal());
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(generateOneImage(store, runtime, input(), signal()), e => e.code === "busy");
  release(result()); await first; assert.equal(calls, 1);
});
test("provider failure, invalid output and cancelled responses retain safe failure records without automatic retries", async t => {
  const store = fixture(t);
  for (const response of [{ ...result(), stopReason: "error", errorMessage: "Bearer secret-token" }, { ...result(), output: [] }, { ...result(), output: [png, png] }, { ...result(), stopReason: "aborted" }]) {
    let calls = 0; const submitted = input();
    const runtime = { getAvailableOfType: async () => [model], generateImages: async () => { calls++; return response; } };
    await assert.rejects(generateOneImage(store, runtime, submitted, signal()), error => !error.message.includes("secret"));
    assert.equal(calls, 1); assert.equal(store.get(submitted.id).status, "failed");
    assert.equal(store.get(submitted.id).usage.cost.total, 0.01);
    assert.equal((await generateOneImage(store, runtime, submitted, signal())).status, "failed"); assert.equal(calls, 1);
  }
});
test("storage rejects linked directories and path traversal", t => {
  const store = fixture(t), outside = join(store.base, "outside"); mkdirSync(outside);
  mkdirSync(join(store.base, "generated-images"));
  try { symlinkSync(outside, store.root, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Link creation unavailable"); return; } throw error; }
  assert.throws(() => store.get(randomUUID())); assert.deepEqual(readdirSync(outside), []);
  assert.throws(() => store.get("../private"));
});
test("image tool stays inactive for read-only, disabled, custom and ordinary runs", async () => {
  let tools = ["read"], registered, runtimeCalls = 0;
  const handlers = {};
  const extension = createImageGenerationExtension({ getRuntime: async () => { runtimeCalls++; throw Error("not called"); } });
  extension.factory({ on: (name, callback) => { handlers[name] = callback; }, getActiveTools: () => tools, setActiveTools: next => { tools = next; }, registerTool: tool => { registered = tool; } });
  const ctx = { sessionManager: { getEntries: () => [] } };
  for (const [active, event] of [[["read"], { messageType: "user", prompt: "帮我生成一张图片" }], [[], { messageType: "user", prompt: "帮我生成一张图片" }], [["write"], { messageType: "custom" }], [["write"], { messageType: "user", prompt: "hello" }]]) {
    tools = active; await handlers.before_agent_start(event, ctx); assert.ok(!tools.includes(registered.name));
    await assert.rejects(registered.execute("call", input(), signal(), undefined, ctx), /not authorized/);
  }
  assert.equal(runtimeCalls, 0);
});

test("real SDK dispatches an explicit chat request to the image provider once, preserves auth and restores normal chat tools", async t => {
  const store = fixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(store.base, "auth.json"), modelsPath: null, modelsStorePath: join(store.base, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("image-fixture", { api: "openai-completions", apiKey: "fixture-test-only", baseUrl: "https://unused.invalid/v1", models: [{ id: "chat", name: "Chat", input: ["text"], reasoning: false, contextWindow: 32000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const chat = runtime.getModel("image-fixture", "chat"), provider = runtime.getProvider("image-fixture");
  const imageModel = { ...chat, id: "image", type: "image", api: "openrouter-images", output: ["image"] };
  let imageCalls = 0, chatCalls = 0;
  runtime.registerNativeProvider({ ...provider, getAllModels: () => [chat, imageModel], generateImages: async (_model, context, options) => {
    imageCalls++; assert.equal(options.apiKey, "fixture-test-only"); assert.equal(options.maxRetries, 0); assert.equal(context.input[0].type, "text"); return { ...result(), api: imageModel.api, provider: imageModel.provider, model: imageModel.id, timestamp: Date.now() };
  }, streamSimple: () => {
    const toolCall = id => ({ type: "toolCall", id, name: "eureka_generate_image", arguments: { provider: "image-fixture", modelId: "image", prompt: "一只猫" } });
    const content = chatCalls++ === 0 ? [toolCall("one"), toolCall("two")] : [{ type: "text", text: "done" }];
    const stopReason = content[0].type === "toolCall" ? "toolUse" : "stop", stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: { role: "assistant", api: chat.api, provider: chat.provider, model: chat.id, content, stopReason, timestamp: Date.now(), usage: result().usage } }));
    return stream;
  } });
  await runtime.refresh({ allowNetwork: false });
  const services = await createAgentSessionServices({ cwd: store.base, agentDir: store.base, modelRuntime: runtime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, cacheWarming: "off" }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [createImageGenerationExtension({ getRuntime: async () => runtime, createStore: () => store })] } });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.create(store.base, join(store.base, "sessions")), model: chat });
  t.after(() => session.dispose());
  await session.prompt("帮我生成一张图片：一只猫");
  assert.equal(imageCalls, 1);
  const results = session.agent.state.messages.filter(message => message.role === "toolResult");
  assert.ok(results.some(message => message.details?.eurekaGeneratedImage?.id));
  assert.ok(results.some(message => message.isError));
  const serialized = JSON.stringify(session.agent.state.messages);
  assert.ok(!serialized.includes(png.data)); assert.ok(!serialized.includes("fixture-test-only"));
  assert.equal(session.model.id, "chat");
  assert.ok(session.sessionFile);
  const restored = SessionManager.open(session.sessionFile).getBranch().filter(entry => entry.type === "message" && entry.message.role === "toolResult");
  const restoredImage = restored.find(entry => entry.message.details?.eurekaGeneratedImage?.id);
  assert.ok(restoredImage, "saved session keeps the image reference after reopening");
  assert.ok(store.image(store.get(restoredImage.message.details.eurekaGeneratedImage.id)).length > 0);
  await session.prompt("hello");
  assert.equal(imageCalls, 1); assert.ok(!session.agent.state.tools.some(tool => tool.name === "eureka_generate_image"));
});
