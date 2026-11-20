import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { classifierQuestion, classifierValue, executeClassification } = await jiti.import("../../features/automation/runtime/automation-app-classifier.ts");
const { parseAppAiRules } = await jiti.import("../../features/automation/runtime/automation-app-ai.ts");
const { parseBusinessAi } = await jiti.import("../../features/automation/runtime/automation-business-ai.ts");
const boolRule = { operation: "classify", instruction: "判断是否有效", output: { type: "boolean" }, classifier: { type: "bool", criteria: { true: "有效", false: "无效" } } };
const result = answer => ({ stopReason: "stop", answers: { result: answer } });

test("old AI rules and preferences remain unchanged; classifier rules are explicit and validated", () => {
  const old = { instruction: "Existing rule", output: { type: "text" } };
  assert.deepEqual(parseAppAiRules(Buffer.from(JSON.stringify({ schemaVersion: 1, rules: { old, boolRule } }))).old, old);
  const settings = { model: null, thinkingLevel: null, timeoutMs: 60000, maxTokens: 4000 };
  assert.deepEqual(parseBusinessAi(settings), settings);
  assert.deepEqual(parseBusinessAi({ ...settings, classifierModel: { provider: "fixture", modelId: "classifier" } }).classifierModel, { provider: "fixture", modelId: "classifier" });
  assert.throws(() => parseBusinessAi({ ...settings, classifierModel: { provider: "fixture", modelId: "classifier", key: "secret" } }));
  assert.throws(() => classifierQuestion({ ...boolRule, output: { type: "text" } }));
});

test("authoring errors identify the rule, nested classifier fields, and valid output types", () => {
  const parse = rule => parseAppAiRules(Buffer.from(JSON.stringify({ schemaVersion: 1, rules: { clothing: rule } })));
  const flat = { operation: "classify", instruction: "Read-only clothing classification", type: "bool", criteria: { true: "Clothing", false: "Other" }, output: { type: "boolean" } };
  assert.throws(() => parse(flat), error => error.message.includes("rules.clothing") && error.message.includes("classifier") && error.message.includes("规则根部"));
  assert.throws(() => parse({ ...boolRule, output: { type: "bool" } }), /rules\.clothing.*output\.type.*boolean/);
  assert.throws(() => parse({ ...boolRule, output: { type: "object", properties: { answer: { type: "text" } } } }), /rules\.clothing.*classifier\.type.*output\.type.*boolean/);
  assert.throws(() => parse({ ...boolRule, classifier: { type: "bool", criteria: ["Yes", "No"] } }), /rules\.clothing.*classifier\.criteria.*不能是数组/);
  assert.equal(parse(boolRule).clothing.output.type, "boolean");
});

test("classification rejects provider failures, type mismatches and values outside declared criteria", () => {
  const question = classifierQuestion(boolRule);
  assert.equal(classifierValue(result({ type: "bool", probability: 0.5 }), question), true);
  assert.equal(classifierValue(result({ type: "bool", probability: 0.1 }), question), false);
  for (const probability of [-1, NaN, 2]) assert.throws(() => classifierValue(result({ type: "bool", probability }), question));
  assert.throws(() => classifierValue({ stopReason: "error", errorMessage: "secret", answers: {} }, question), error => !error.message.includes("secret"));
  const choice = { type: "choice", instructions: "category", criteria: { a: "A", b: "B" } };
  assert.equal(classifierValue(result({ type: "choice", choice: "a" }), choice), "a");
  assert.throws(() => classifierValue(result({ type: "choice", choice: "c" }), choice));
  const score = { type: "score", instructions: "quality", criteria: ["poor", "good", "excellent"] };
  assert.equal(classifierValue(result({ type: "score", score: 1.5 }), score), 1.5);
  assert.throws(() => classifierValue(result({ type: "score", score: 3 }), score));
});

test("classification uses only the selected classifier, records safe usage, and never dispatches cancelled or unsupported image calls", async () => {
  const model = { provider: "fixture", id: "classifier", input: ["text"] }, calls = [], recorded = [], pinned = [];
  const runtime = { getAvailableOfType: async () => [model], classify: async (...args) => { calls.push(args); return { ...result({ type: "bool", probability: 0.8 }), usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0.01 }, secret: "no" } }; } };
  const options = { classifierModel: { provider: model.provider, modelId: model.id }, onModel: async (...args) => pinned.push(args), onUsage: async entry => recorded.push(entry) };
  assert.equal(await executeClassification(runtime, boolRule, { text: "data" }, new AbortController().signal, () => {}, options), true);
  assert.equal(calls.length, 1); assert.equal(calls[0][2].maxRetries, 0);
  assert.equal(pinned[0][1], "classify"); assert.equal(recorded[0].usage.cost.total, 0.01); assert.ok(!JSON.stringify(recorded).includes("secret"));
  await assert.rejects(executeClassification(runtime, boolRule, {}, new AbortController().signal, () => {}, {}), /选择分类模型/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(executeClassification(runtime, boolRule, {}, abort.signal, () => {}, options), /取消/);
  await assert.rejects(executeClassification(runtime, boolRule, {}, new AbortController().signal, () => {}, { ...options, inputOptions: { images: [{}] } }), /不支持图片/);
  assert.equal(calls.length, 1);
});

test("real SDK ModelRuntime resolves classifier catalogs and dispatches without adding classifiers to chat models", async t => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-classifier-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, modelsStorePath: join(dir, "models-store.json") });
  runtime.registerProvider("fixture", { api: "openai-completions", baseUrl: "https://unused.invalid", apiKey: "fixture", models: [{ id: "chat", name: "Chat", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 64, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const provider = runtime.getProvider("fixture"), calls = [], usages = [];
  const classifier = { type: "classifier", api: "typesafe-system-one", provider: "fixture", id: "judge", name: "Fixture classifier", input: ["text"], baseUrl: "https://unused.invalid", contextWindow: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  runtime.registerNativeProvider({ ...provider, getAllModels: () => [...provider.getModels(), classifier], classify: async (model, context) => { calls.push({ model, context }); return { ...result({ type: "bool", probability: 0.75 }), provider: model.provider, model: model.id, api: model.api, timestamp: Date.now() }; } });
  await runtime.refresh({ allowNetwork: false });
  assert.ok(!runtime.getModels().some(model => model.id === "judge"));
  assert.ok((await runtime.getAvailableOfType("classifier")).some(model => model.id === "judge"));
  assert.equal(await executeClassification(runtime, boolRule, { value: "fixture data" }, new AbortController().signal, () => {}, { classifierModel: { provider: "fixture", modelId: "judge" }, onUsage: async usage => usages.push(usage) }), true);
  assert.equal(calls.length, 1); assert.equal(calls[0].model.type, "classifier");
  assert.deepEqual(calls[0].context.state, { input: { value: "fixture data" } });
  assert.ok(!Object.hasOwn(usages[0], "usage"), "providers without usage must still produce JSON-safe audit entries");
});
