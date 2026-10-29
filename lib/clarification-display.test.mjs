import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { clarificationContinuationText } = await jiti.import("./clarification.ts");
const { clarificationContinuationIndices, clarificationToolResult } = await jiti.import("./clarification-display.ts");
const { buildTaskPhases } = await jiti.import("./task-phases.ts");
const { selectionEnvelope } = await jiti.import("./plugin-selection.ts");

const group = { id: "ask-date", task: { id: "task", plugins: [], clarificationEnabled: true }, source: "general",
  status: "answered", continuation: "completed", createdAt: "2026-10-21T01:00:00Z", questions: [
    { id: "date", toolCallId: "ask-date", title: "查询月份", question: "8月指哪个年份？", status: "answered",
      options: [], answer: { text: "2026年8月", custom: true }, askedAt: "2026-10-21T01:00:00Z" },
  ] };
const user = (content) => ({ role: "user", content });
const call = (id, name = "request_user_input") => ({ type: "toolCall", toolCallId: id, toolName: name, input: {} });
const assistant = (content, stopReason = "toolUse") => ({ role: "assistant", content, stopReason, model: "test", provider: "test" });
const original = { role: "toolResult", toolCallId: group.id, content: [{ type: "text", text: "waiting" }], details: { groupId: group.id } };
const labels = { waiting: "等待回答", skipped: "已跳过", cancelled: "已取消澄清" };

test("host answers and retries stay inside the original task, including plugin envelopes and text-block histories", () => {
  const answer = clarificationContinuationText(group);
  const messages = [user("查询8月"), assistant([call(group.id)]), original,
    user(selectionEnvelope(answer, [{ source: "haze", capabilityId: "66", digest: "a", name: "Atlas" }])),
    assistant([call("query", "mcp")]), user([{ type: "text", text: answer }]), assistant([{ type: "text", text: "查询完成" }], "stop")];
  assert.deepEqual([...clarificationContinuationIndices(messages, [group])], [3, 5]);
  const sources = messages.flatMap((message, messageIndex) => message.role === "assistant" ? [{ message, messageIndex }] : []);
  const turn = buildTaskPhases(sources, { running: false, toolResults: new Map([[group.id, original], ["query", { ...original, toolCallId: "query" }]]), clarificationGroups: new Map([[group.id, group]]) });
  assert.equal(turn.status, "completed");
  assert.ok(turn.phases.every((phase) => phase.status === "completed"));
  assert.equal(turn.phases.reduce((n, phase) => n + phase.toolCallCount, 0), 2);
});

test("matching requires an answered group and its own preceding tool call; ordinary user replies remain visible", () => {
  const answer = clarificationContinuationText(group);
  const messages = [user(answer), assistant([call("unrelated")]), user(answer), assistant([call(group.id)]), user("已回答问题澄清：2026年8月"), user(answer)];
  assert.equal(clarificationContinuationIndices(messages, [group]).size, 0);
  assert.equal(clarificationContinuationIndices([assistant([call(group.id)]), user(answer)], [{ ...group, status: "pending" }]).size, 0);
  assert.equal(clarificationContinuationIndices([assistant([call(group.id)]), user([{ type: "text", text: answer }, { type: "image", source: {} }])], [group]).size, 0);
});

test("waiting for clarification is not an incomplete task, while real errors and missing tool results remain visible", () => {
  const source = { message: assistant([call(group.id)]), messageIndex: 1 };
  const options = { running: false, toolResults: new Map([[group.id, original]]), clarificationGroups: new Map([[group.id, { ...group, status: "pending", continuation: "ready" }]]) };
  assert.equal(buildTaskPhases([source], options).status, "waiting_input");
  assert.equal(buildTaskPhases([source], options).phases[0].status, "waiting_input");
  assert.equal(buildTaskPhases([source], { ...options, clarificationGroups: new Map([[group.id, { ...group, continuation: "failed" }]]) }).status, "failed");
  assert.equal(buildTaskPhases([{ ...source, message: assistant([call(group.id)], "error") }], options).status, "failed");
  assert.equal(buildTaskPhases([{ ...source, message: assistant([call("missing", "read"), call(group.id)]) }], options).phases[0].status, "waiting_input");
  assert.equal(buildTaskPhases([{ ...source, message: assistant([call("missing", "read")]) }], options).status, "incomplete");
});

test("tool details contain saved answers, custom text and explicit skips without mutating the actual result", () => {
  const result = clarificationToolResult(group, original, labels);
  assert.match(result.content[0].text, /8月指哪个年份？\n2026年8月/);
  assert.equal(result.details.eurekaClarificationSummary, "查询月份：2026年8月");
  assert.equal(original.content[0].text, "waiting");
  const skipped = { ...group, questions: [{ ...group.questions[0], answer: { text: "Skipped", skipped: true, custom: false } }] };
  assert.match(clarificationToolResult(skipped, original, labels).content[0].text, /已跳过/);
  assert.match(clarificationToolResult({ ...group, status: "pending" }, original, labels).content[0].text, /等待回答/);
  const error = { ...original, isError: true };
  assert.equal(clarificationToolResult(group, error, labels), error);
});
