import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildTaskPhases } = await jiti.import("./task-phases.ts");
const text = (value) => ({ type: "text", text: value });
const thought = (value = "reasoning") => ({ type: "thinking", thinking: value });
const call = (id, toolName = "read") => ({ type: "toolCall", toolCallId: id, toolName, input: { path: "README.md" } });
const source = (content, messageIndex, extra = {}) => ({ message: { role: "assistant", provider: "test", model: "test", content, timestamp: 1000, ...extra.message }, messageIndex, entryId: "entry-" + messageIndex, ...extra });
const result = (id, isError = false) => ({ role: "toolResult", toolCallId: id, isError, content: [], timestamp: 2000 });
const results = (...ids) => new Map(ids.map((id) => [id, result(id)]));

test("updates group multiple assistant/tool rounds into one stage until the next explanation", () => {
  const turn = buildTaskPhases([
    source([text("Inspect the project."), thought(), call("a")], 1),
    source([thought(), call("b", "ls")], 3),
    source([thought("prepare"), text("Now update the code."), call("c", "edit")], 5),
  ], { running: true, toolResults: results("a", "b"), runningToolIds: new Set(["c"]) });
  assert.equal(turn.phases.length, 2);
  assert.deepEqual(turn.phases.map((phase) => phase.toolCallCount), [2, 1]);
  assert.deepEqual(turn.phases.map((phase) => phase.thinkingCount), [2, 1]);
  assert.deepEqual(turn.phases.map((phase) => phase.status), ["completed", "running"]);
  assert.equal(turn.phases[1].items[0].source.entryId, "entry-5");
  assert.equal(turn.phases[1].items[0].blockIndex, 0);
});

test("success extracts only the terminal answer and leaves stage notes in processing details", () => {
  const turn = buildTaskPhases([
    source([text("Inspect first."), call("a")], 1),
    source([text("Update next."), call("b", "edit")], 3),
    source([thought("verify"), text("Done."), { type: "image", data: "abc", mimeType: "image/png" }], 5),
  ], { running: false, toolResults: results("a", "b") });
  assert.equal(turn.status, "completed");
  assert.equal(turn.phases.length, 2);
  assert.ok(turn.phases.every((phase) => phase.status === "completed"));
  assert.equal(turn.answerSource.messageIndex, 5);
  assert.deepEqual(turn.answerBlockIndices, [1, 2]);
  assert.deepEqual(turn.phases.map((phase) => phase.summary[0].block.text), ["Inspect first.", "Update next."]);
});

test("the active stage stays open while the model waits after tools finish", () => {
  const turn = buildTaskPhases([source([text("Read the project."), call("a")], 1)], { running: true, toolResults: results("a") });
  assert.equal(turn.status, "running");
  assert.equal(turn.phases[0].status, "running");
  assert.equal(turn.answerSource, undefined);
});

test("parallel unfinished tools prevent premature stage completion", () => {
  const turn = buildTaskPhases([
    source([text("Read files."), call("a"), call("b")], 1),
    source([text("Verify the output."), call("c", "bash")], 3),
  ], { running: true, toolResults: results("a"), runningToolIds: new Set(["b", "c"]) });
  assert.deepEqual(turn.phases.map((phase) => phase.status), ["running", "running"]);
});

test("no commentary uses one action-derived stage, retaining original deferred-thinking indexes", () => {
  const original = source([text(""), { type: "thinking", thinking: "", deferred: true }, call("a", "edit")], 1);
  const turn = buildTaskPhases([original, source([call("b", "edit")], 3)], { running: true, toolResults: results("a") });
  assert.equal(turn.phases.length, 1);
  assert.equal(turn.phases[0].fallbackKey, "taskPhase.editing");
  assert.equal(turn.phases[0].items[0].blockIndex, 1);
  assert.equal(turn.phases[0].items[0].source, original);
  assert.equal(turn.phases[0].toolCallCount, 2);
});

test("consecutive explanations without tool execution merge rather than creating empty stages", () => {
  const turn = buildTaskPhases([source([text("Start."), text("Read the config."), thought(), call("a")], 1)], { running: true });
  assert.equal(turn.phases.length, 1);
  assert.equal(turn.phases[0].summary.length, 2);
});

test("a new explanation after a thinking round starts a new stage without tools", () => {
  const turn = buildTaskPhases([
    source([text("Analyze the requirements."), thought("requirements")], 1),
    source([thought("compare"), text("Now compare the options."), thought("options")], 2),
  ], { running: true });
  assert.equal(turn.phases.length, 2);
  assert.deepEqual(turn.phases.map((phase) => phase.thinkingCount), [1, 2]);
  assert.deepEqual(turn.phases.map((phase) => phase.status), ["completed", "running"]);
});

test("pure text answers have no empty processing group, during streaming or after completion", () => {
  for (const running of [true, false]) {
    const turn = buildTaskPhases([source([text("Hello.")], 1, { isStreaming: running })], { running });
    assert.equal(turn.phases.length, 0);
    assert.deepEqual(turn.answerBlockIndices, [0]);
  }
});

test("an initial wait and pure thinking both have a visible active stage", () => {
  assert.equal(buildTaskPhases([], { running: true }).phases[0].fallbackKey, "taskPhase.analyzing");
  const turn = buildTaskPhases([source([thought("")], 1, { isStreaming: true })], { running: true });
  assert.equal(turn.phases[0].thinkingCount, 1);
  assert.equal(turn.phases[0].status, "running");
});

test("failed, aborted, and absent-final-answer turns do not appear successfully completed", () => {
  for (const [stopReason, expected] of [["error", "failed"], ["aborted", "stopped"], ["toolUse", "incomplete"]]) {
    const turn = buildTaskPhases([source([call("a")], 1, { message: { role: "assistant", provider: "test", model: "test", content: [call("a")], stopReason, errorMessage: "failure" } })], { running: false });
    assert.equal(turn.status, expected);
    assert.equal(turn.phases[0].status, expected);
    if (expected === "failed") assert.equal(turn.answerSource.message.errorMessage, "failure");
  }
});

test("stream-to-commit overlap never doubles tool or thinking rows", () => {
  const saved = source([thought(), call("a")], 1);
  const stream = source([thought(), call("a")], 2, { isStreaming: true });
  const turn = buildTaskPhases([saved, stream], { running: true });
  assert.equal(turn.phases[0].toolCallCount, 1);
  assert.equal(turn.phases[0].thinkingCount, 1);
  assert.equal(turn.phases[0].items[0].source, saved);
});

test("stable stage identities survive token deltas and newly arriving results", () => {
  const before = buildTaskPhases([source([text("Starting"), thought(), call("a")], 1)], { running: true });
  const after = buildTaskPhases([source([text("Starting work."), thought("more reasoning"), call("a")], 1)], { running: true, toolResults: results("a") });
  assert.equal(before.phases[0].id, after.phases[0].id);
  assert.equal(after.phases[0].status, "running");
});

test("native plan text can stay outside phases while it streams", () => {
  const turn = buildTaskPhases([source([call("a")], 1), source([thought(), text("# Implementation plan")], 3, { isStreaming: true })], {
    running: true, toolResults: results("a"),
  });
  assert.equal(turn.answerSource.messageIndex, 3);
  assert.deepEqual(turn.answerBlockIndices, [1]);
  assert.ok(turn.phases.every((phase) => phase.summary.length === 0));
});

test("streaming result text stays outside the process with all preceding thinking above it", () => {
  const final = source([thought("Verify calculations"), text("Results: 164 → 410")], 3, { isStreaming: true });
  const turn = buildTaskPhases([source([text("Calculate changes."), thought(), call("a", "bash")], 1), final], {
    running: true, toolResults: results("a"),
  });
  assert.equal(turn.status, "running");
  assert.equal(turn.phases.length, 1);
  assert.equal(turn.phases[0].status, "completed");
  assert.equal(turn.phases[0].thinkingCount, 2);
  assert.deepEqual(turn.phases[0].summary.map((ref) => ref.block.text), ["Calculate changes."]);
  assert.equal(turn.answerSource, final);
  assert.deepEqual(turn.answerBlockIndices, [1]);
  assert.equal(turn.phases[0].items.at(-1).source, final);
  assert.equal(turn.phases[0].items.at(-1).blockIndex, 0);
});

test("a new tool reclassifies a provisional streaming reply as commentary without losing its thinking", () => {
  const previous = source([text("Inspect."), call("a")], 1);
  const partial = source([thought("Choose changes"), text("Now edit.")], 3, { isStreaming: true });
  const before = buildTaskPhases([previous, partial], { running: true, toolResults: results("a") });
  assert.equal(before.phases.length, 1);
  assert.deepEqual(before.answerBlockIndices, [1]);
  const next = { ...partial, message: { ...partial.message, content: [...partial.message.content, call("b", "edit")] } };
  const after = buildTaskPhases([previous, next], { running: true, toolResults: results("a"), runningToolIds: new Set(["b"]) });
  assert.equal(after.answerSource, undefined);
  assert.deepEqual(after.phases.map((phase) => phase.status), ["completed", "running"]);
  assert.deepEqual(after.phases.map((phase) => phase.toolCallCount), [1, 1]);
  assert.deepEqual(after.phases.map((phase) => phase.thinkingCount), [0, 1]);
  assert.equal(after.phases[1].summary[0].block.text, "Now edit.");
  assert.equal(after.phases[1].items[0].blockIndex, 0);
});

test("committed reply and stream overlap retain one process before completion notification", () => {
  const committed = source([thought("Verify"), text("Done.")], 3);
  const stream = { ...committed, messageIndex: 4, entryId: undefined, isStreaming: true };
  const turn = buildTaskPhases([source([call("a")], 1), committed, stream], { running: true, toolResults: results("a") });
  assert.equal(turn.status, "running");
  assert.equal(turn.phases.length, 1);
  assert.equal(turn.phases[0].status, "completed");
  assert.equal(turn.phases[0].thinkingCount, 1);
  assert.equal(turn.answerSource, committed);
  assert.deepEqual(turn.answerBlockIndices, [1]);
});

test("persisted plan text is excluded from progress descriptions", () => {
  const turn = buildTaskPhases([source([text("Plan card"), thought(), call("a")], 1)], {
    running: true, summaryExcludedMessageIndices: new Set([1]),
  });
  assert.equal(turn.phases[0].summary.length, 0);
  assert.equal(turn.phases[0].toolCallCount, 1);
});

test("internal plan completion markers and empty historic thinking do not inflate counts", () => {
  const turn = buildTaskPhases([source([thought(""), call("hidden", "mark_plan_done"), call("a")], 1), source([text("Done")], 3)], {
    running: false, toolResults: results("a"),
  });
  assert.equal(turn.phases[0].thinkingCount, 0);
  assert.equal(turn.phases[0].toolCallCount, 1);
});
