import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { Agent, runToolCall } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, validateToolArguments } from "@earendil-works/pi-ai";
import { createAgentSessionServices, ModelRuntime, SettingsManager, wrapRegisteredTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Format } from "typebox/format";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { prepareDirectToolArguments } = await jiti.import("../../node_modules/pi-mcp-adapter/direct-tools.ts");
const { normalizeDirectToolInputSchema } = await jiti.import("../../node_modules/pi-mcp-adapter/utils.ts");
const { EUREKA_NATIVE_PLAN_EXTENSION } = await jiti.import("../../server/agent/rpc-manager.ts");
const { EUREKA_AUTOMATION_CHAT_EXTENSION } = await jiti.import("../../features/automation/runtime/automation-chat-extension.ts");
const { EUREKA_AUTOMATION_INTAKE_EXTENSION } = await jiti.import("../../features/automation/authoring/automation-intake-extension.ts");

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (content, stopReason = "stop") => ({ role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", content, stopReason, timestamp: Date.now(), usage });
const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const errorText = (outcome) => outcome.result.content.map((block) => block.text ?? "").join("\n");
const makeTool = (parameters, execute) => ({ name: "fixture_tool", label: "Fixture", description: "Local schema fixture", parameters, execute });

async function call(tool, args, hooks = {}) {
  const toolCall = { type: "toolCall", id: "fixture-call", name: tool.name, arguments: args };
  return runToolCall(toolCall, {
    tools: [tool], assistantMessage: message([toolCall], "toolUse"), context: { messages: [], tools: [tool] }, ...hooks,
  });
}

const plainSchema = {
  type: "object", properties: {
    count: { type: "integer", minimum: 1, maximum: 5 },
    enabled: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  }, required: ["count", "enabled", "tags"], additionalProperties: false,
};
const typeboxSchema = Type.Object({
  count: Type.Integer({ minimum: 1, maximum: 5 }), enabled: Type.Boolean(), tags: Type.Array(Type.String()), note: Type.Optional(Type.String()),
}, { additionalProperties: false });

for (const [kind, schema] of [["TypeBox", typeboxSchema], ["plain JSON Schema", plainSchema]]) {
  test(`${kind} tools receive coerced arguments without mutating transcript input`, async () => {
    let received;
    const tool = makeTool(schema, async (_id, args) => { received = args; return text(args); });
    const input = { count: "2", enabled: "true", tags: "one", note: null };
    const before = structuredClone(input);
    const result = await call(tool, input);
    assert.equal(result.isError, false, errorText(result));
    assert.deepEqual(received, { count: 2, enabled: true, tags: ["one"] });
    assert.deepEqual(input, before);
  });

  test(`${kind} rejects missing, out-of-range, invalid-type and unexpected properties before execution`, async () => {
    let executions = 0;
    const tool = makeTool(schema, async () => { executions++; return text("executed"); });
    for (const args of [
      { enabled: true, tags: [] },
      { count: 0, enabled: true, tags: [] },
      { count: 2, enabled: "not-a-boolean", tags: [] },
      { count: 2, enabled: true, tags: [], unexpected: "value" },
    ]) {
      const result = await call(tool, args);
      assert.equal(result.isError, true);
      assert.match(errorText(result), /Validation failed/);
      assert.equal(result.durationMs, undefined, "execute must not be reached");
    }
    assert.equal(executions, 0);
  });
}

test("SDK schema errors reach the model and a corrected call executes exactly once", async () => {
  const values = [];
  let requests = 0;
  const tool = makeTool(Type.Object({ count: Type.Integer({ minimum: 1 }) }), async (_id, args) => { values.push(args.count); return text(args); });
  const agent = new Agent({
    initialState: { model: { id: "fixture", provider: "fixture", api: "openai-completions" }, tools: [tool] },
    streamFn: (_model, context) => {
      requests++;
      if (requests === 2) {
        const failure = context.messages.find((entry) => entry.role === "toolResult");
        assert.equal(failure.isError, true);
        assert.match(failure.content[0].text, /count: missing/);
      }
      assert.ok(requests <= 3, "fixture must settle");
      const response = requests <= 2
        ? message([{ type: "toolCall", id: `call-${requests}`, name: tool.name, arguments: requests === 1 ? {} : { count: "3" } }], "toolUse")
        : message([{ type: "text", text: "Done" }]);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => stream.push({ type: "done", reason: response.stopReason, message: response }));
      return stream;
    },
  });
  await agent.prompt("Run the fixture");
  assert.equal(requests, 3);
  assert.deepEqual(values, [3]);
});

test("coerced arguments still pass through permission hooks before execution", async () => {
  let executions = 0;
  const tool = makeTool(typeboxSchema, async () => { executions++; return text("executed"); });
  const result = await call(tool, { count: "2", enabled: "true", tags: "one" }, {
    beforeToolCall: ({ args }) => {
      assert.equal(args.count, 2);
      return { block: true, reason: "Fixture permission denied" };
    },
  });
  assert.equal(result.isError, true);
  assert.match(errorText(result), /Fixture permission denied/);
  assert.equal(executions, 0);
});

test("a third-party TypeScript extension imports legacy Type helpers and executes through the SDK wrapper", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-tool-schema-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "auth.json"), "{}");
  const path = join(dir, "fixture-extension.ts");
  await writeFile(path, `import { Type } from "@earendil-works/pi-ai";
export default (pi) => pi.registerTool({ name: "third_party_fixture", label: "Fixture", description: "Schema compatibility",
  parameters: Type.Object({ mode: Type.Union([Type.Literal("read"), Type.Literal("inspect")]), limit: Type.Integer({ minimum: 1 }), note: Type.Optional(Type.String()) }),
  execute: async (_id, args, _signal, _update, ctx) => ({ content: [{ type: "text", text: JSON.stringify({ args, cwd: ctx.cwd }) }] }) });`);
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime: runtime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [path] },
  });
  const loaded = services.resourceLoader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const registered = loaded.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "third_party_fixture");
  assert.ok(registered);
  const tool = wrapRegisteredTool(registered, { createToolContext: () => ({ cwd: dir }) });
  const success = await call(tool, { mode: "inspect", limit: "4", note: null });
  assert.equal(success.isError, false, errorText(success));
  assert.deepEqual(JSON.parse(success.result.content[0].text), { args: { mode: "inspect", limit: 4 }, cwd: dir });
  assert.equal((await call(tool, { mode: "delete", limit: 4 })).isError, true);
});

test("MCP direct schemas retain SDK coercion and the adapter's optional strict argument preparation", async () => {
  const inputSchema = { $schema: "https://json-schema.org/draft-07/schema#", ...plainSchema };
  const requests = [];
  const tool = makeTool(Type.Unsafe(normalizeDirectToolInputSchema(inputSchema)), async (_id, args) => { requests.push(args); return text(args); });
  const ordinary = await call(tool, { count: "2", enabled: "true", tags: "one" });
  assert.equal(ordinary.isError, false, errorText(ordinary));
  assert.deepEqual(requests, [{ count: 2, enabled: true, tags: ["one"] }]);
  const strict = { ...tool, prepareArguments: (args) => prepareDirectToolArguments(inputSchema, args) };
  const recovered = await call(strict, { count: 2, enabled: true, tags: '["two"]' });
  assert.equal(recovered.isError, false, errorText(recovered));
  assert.deepEqual(requests[1], { count: 2, enabled: true, tags: ["two"] });
  const rejected = await call(strict, { count: 2, enabled: true, tags: [], unexpected: "value" });
  assert.equal(rejected.isError, true);
  assert.match(errorText(rejected), /advertised input schema/);
  assert.equal(requests.length, 2);
});

test("current Eureka planning and automation schemas validate with the new SDK", () => {
  const tools = new Map();
  const pi = { registerTool: (tool) => tools.set(tool.name, tool), on() {} };
  for (const extension of [EUREKA_NATIVE_PLAN_EXTENSION, EUREKA_AUTOMATION_CHAT_EXTENSION, EUREKA_AUTOMATION_INTAKE_EXTENSION]) extension.factory(pi);
  const validate = (name, args) => validateToolArguments(tools.get(name), { type: "toolCall", id: "fixture", name, arguments: args });
  assert.equal(validate("mark_plan_done", { taskIndex: "1" }).taskIndex, 1);
  assert.throws(() => validate("mark_plan_done", { taskIndex: 0 }), /Validation failed/);
  const params = validate("request_user_input", { questions: [{ title: "Date", question: "Choose", options: [{ id: "one", label: "One", description: "First" }, { id: "two", label: "Two", description: "Second" }] }] });
  assert.equal(params.questions.length, 1);
  assert.throws(() => validate("request_user_input", { questions: [{ title: "Date", question: "Choose", options: [] }] }), /Validation failed/);
  assert.deepEqual(validate("eureka_app_browser", { method: "read", args: ["fixture"] }).args, ["fixture"]);
  assert.equal(validate("eureka_app_source", { path: "E:\\source\\api.py", method: "readText", offset: "2", limit: "50" }).offset, 2);
  assert.throws(() => validate("eureka_app_source", { path: "E:\\source", method: "writeText" }), /Validation failed/);
  assert.throws(() => validate("eureka_app_source", { path: "E:\\source", method: "readText", limit: 301 }), /Validation failed/);
  assert.equal(validate("eureka_app_write", { baseDigest: "a".repeat(64), edits: [{ path: "scripts/main.mjs", oldText: "old", newText: "new" }] }).edits.length, 1);
  assert.throws(() => validate("eureka_app_browser", {}), /Validation failed/);
  assert.equal(validate("eureka_automation_run", { appId: "fixture", mode: "status", waitSeconds: "5" }).waitSeconds, 5);
  assert.throws(() => validate("eureka_automation_run", { appId: "fixture", mode: "unknown" }), /Validation failed/);
  assert.throws(() => validate("eureka_automation_run", { appId: "fixture", mode: "status", waitSeconds: 11 }), /Validation failed/);
});

test("JSON Schema references and literal property names retain their constraints", async () => {
  const schema = {
    type: "object", properties: { "account.id": { type: "string" }, limit: { $ref: "#/$defs/Limit" }, optional: { $ref: "#/$defs/Missing" } },
    required: ["account.id", "limit"], additionalProperties: false, $defs: { Limit: { type: "integer", minimum: 1 } },
  };
  const tool = makeTool(schema, async (_id, args) => text(args));
  assert.equal((await call(tool, { "account.id": "fixture", limit: "2" })).isError, false);
  for (const args of [
    { accountXid: "fixture", limit: 2 },
    { "account.id": "fixture", limit: 0 },
    { "account.id": "fixture", limit: 2, optional: "unresolved" },
  ]) assert.equal((await call(tool, args)).isError, true);
});

test("non-JSON TypeBox types reject arguments before execution", async () => {
  let executions = 0;
  for (const schema of [Type.BigInt(), Type.Undefined(), Type.Void()]) {
    const tool = makeTool(Type.Object({ value: schema }), async () => { executions++; return text("executed"); });
    assert.equal((await call(tool, { value: "12" })).isError, true);
  }
  assert.equal(executions, 0);
});

test("TypeBox refinements require explicit execute checks and codecs keep JSON inputs", async () => {
  let refinements = 0, mutations = 0;
  const schema = Type.Object({ value: Type.Refine(Type.Number(), (value) => { refinements++; return value > 0; }) });
  const tool = makeTool(schema, async (_id, args) => {
    if (args.value <= 0) throw new Error("Value must be positive");
    mutations++;
    return text(args);
  });
  const denied = await call(tool, { value: -1 });
  assert.equal(denied.isError, true);
  assert.match(errorText(denied), /Value must be positive/);
  assert.equal(refinements, 0, "SDK intentionally validates JSON Schema rather than TypeBox callbacks");
  assert.equal(mutations, 0);
  assert.equal((await call(tool, { value: 1 })).isError, false);
  assert.equal(mutations, 1);

  let decodes = 0;
  const codec = Type.Codec(Type.String()).Decode((value) => { decodes++; return Number(value); }).Encode(String);
  let received;
  const jsonTool = makeTool(Type.Object({ value: codec }), async (_id, args) => { received = args.value; return text(args); });
  assert.equal((await call(jsonTool, { value: "12" })).isError, false);
  assert.equal(received, "12");
  assert.equal(decodes, 0);
});

test("standard formats validate while custom TypeBox formats require execute checks", async (t) => {
  const previous = Format.Entries();
  t.after(() => { Format.Clear(); for (const [name, check] of previous) Format.Set(name, check); });
  let formatChecks = 0, mutations = 0;
  Format.Set("eureka-fixture-account", (value) => { formatChecks++; return /^ACC-\d+$/.test(value); });
  const tool = makeTool(Type.Object({ account: Type.String({ format: "eureka-fixture-account" }) }), async (_id, args) => {
    if (!/^ACC-\d+$/.test(args.account)) throw new Error("Invalid account identifier");
    mutations++;
    return text(args);
  });
  const denied = await call(tool, { account: "invalid" });
  assert.equal(denied.isError, true);
  assert.match(errorText(denied), /Invalid account identifier/);
  assert.equal(formatChecks, 0);
  assert.equal(mutations, 0);
  assert.equal((await call(tool, { account: "ACC-12" })).isError, false);
  assert.equal(mutations, 1);
  const email = makeTool(Type.Object({ email: Type.String({ format: "email" }) }), async (_id, args) => text(args));
  assert.equal((await call(email, { email: "invalid" })).isError, true);
  assert.equal((await call(email, { email: "fixture@example.invalid" })).isError, false);
});
