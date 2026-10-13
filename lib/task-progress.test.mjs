import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { taskProgressSystemPrompt, TASK_PROGRESS_INSTRUCTIONS, EUREKA_TASK_PROGRESS_EXTENSION } = await jiti.import("./task-progress.ts");

test("progress instructions append to the existing system prompt once", () => {
  const prompt = taskProgressSystemPrompt("Existing instructions", true, "executing");
  assert.equal(prompt, "Existing instructions\n\n" + TASK_PROGRESS_INSTRUCTIONS);
  assert.equal(taskProgressSystemPrompt(prompt, true), undefined);
});

test("disabled tools and native planning/review keep their exact original prompt", () => {
  assert.equal(taskProgressSystemPrompt("", false), undefined);
  for (const phase of ["planning", "reviewing"]) assert.equal(taskProgressSystemPrompt("Native format", true, phase), undefined);
});

test("before_agent_start uses the SDK hook without persisting messages or requesting another model", () => {
  let handler;
  let activeTools = ["read"];
  EUREKA_TASK_PROGRESS_EXTENSION.factory({
    on: (name, listener) => { assert.equal(name, "before_agent_start"); handler = listener; },
    getActiveTools: () => activeTools,
  });
  const context = { sessionManager: { getEntries: () => [] } };
  const result = handler({ systemPrompt: "Base prompt" }, context);
  assert.equal(result.systemPrompt, "Base prompt\n\n" + TASK_PROGRESS_INSTRUCTIONS);
  assert.deepEqual(Object.keys(result), ["systemPrompt"]);
  activeTools = [];
  assert.equal(handler({ systemPrompt: "" }, context), undefined);
});

test("new RPC runtimes register progress after the native plan extension", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /extensionFactories: \[[^\]]*EUREKA_NATIVE_PLAN_EXTENSION[^\]]*EUREKA_TASK_PROGRESS_EXTENSION/);
});
