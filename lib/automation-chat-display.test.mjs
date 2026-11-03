// Regression sources for user-run verification; no app, browser or model runs.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const { chatAutomationAnchors, chatAutomationExpanded } = await createJiti(import.meta.url).import("./automation-chat-display.ts");
const user = content => ({ role: "user", content });
const result = (id, name, details) => ({ role: "toolResult", toolName: "eureka_automation_run", toolCallId: randomUUID(),
  content: [{ type: "text", text: JSON.stringify({ invocationId: id, name }) }], details });

test("two applications stay at their original turns, status checks do not duplicate or move them", () => {
  const first = randomUUID(), second = randomUUID();
  const messages = [user("查找尺码图"), result(first, "尺码图片查找器"), user("查询商品"), result(second, "千牛商品批量查询"),
    user("查看第一次结果"), result(first, "尺码图片查找器")];
  assert.deepEqual(chatAutomationAnchors(messages), [
    { id: first, messageIndex: 1, name: "尺码图片查找器" },
    { id: second, messageIndex: 3, name: "千牛商品批量查询" },
  ]);
  assert.deepEqual(chatAutomationAnchors(JSON.parse(JSON.stringify(messages))), chatAutomationAnchors(messages));
});

test("new invocations fold older cards, while users can reopen them without changing the run", () => {
  const first = randomUUID(), second = randomUUID();
  assert.equal(chatAutomationExpanded(first, first), true);
  assert.equal(chatAutomationExpanded(first, second), false);
  assert.equal(chatAutomationExpanded(second, second), true);
  assert.equal(chatAutomationExpanded(first, second, { latestId: second, open: true }), true);
  assert.equal(chatAutomationExpanded(first, second, { latestId: first, open: true }), false);
});

test("old JSON results and new structured metadata survive reload; malformed or ordinary tools do not create cards", () => {
  const id = randomUUID();
  const saved = result(id, "尺码图片查找器", { automationInvocation: true, invocationId: id, name: "尺码图片查找器" });
  saved.content = [{ type: "text", text: "non-JSON display excerpt" }];
  assert.equal(chatAutomationAnchors(JSON.parse(JSON.stringify([saved])))[0].id, id);
  assert.deepEqual(chatAutomationAnchors([{ ...saved, toolName: "read" }, { ...saved, details: undefined }, result("invalid", "bad")]), []);
});
