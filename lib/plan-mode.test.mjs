import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  EMPTY_PLAN_STATE,
  getSessionPlans,
  isReviewablePlan,
  markPlanTodosDone,
  getPendingPlanQuestion,
  parsePlanTodos,
  readPlanState,
} = await jiti.import("./plan-mode.ts");

test("extracts a stable implementation checklist from Markdown", () => {
  assert.deepEqual(parsePlanTodos("# Plan\n- [ ] add endpoint\n- [x] existing work\n* verify behavior"), [
    { index: 1, text: "add endpoint", done: false },
    { index: 2, text: "existing work", done: true },
    { index: 3, text: "verify behavior", done: false },
  ]);
});

test("only marks checklist items named by DONE markers", () => {
  const todos = parsePlanTodos("- one\n- two\n- three");
  assert.deepEqual(markPlanTodosDone(todos, "Completed the first item [DONE:1] and third [DONE:3]."), [
    { index: 1, text: "one", done: true },
    { index: 2, text: "two", done: false },
    { index: 3, text: "three", done: true },
  ]);
});

test("accepts only a structured plan for review", () => {
  assert.equal(isReviewablePlan("# 目标\n实现图片调整。\n\n# 实施步骤\n- [ ] 新增处理逻辑\n\n# 验证\n- 运行测试"), true);
  assert.equal(isReviewablePlan("下面是完整脚本：\n```python\nprint('hello')\n```"), false);
});

test("restores the most recent persisted plan state", () => {
  const latest = {
    ...EMPTY_PLAN_STATE,
    phase: "reviewing",
    revision: 2,
    content: "# latest",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const restored = readPlanState([
    { type: "custom", customType: "eureka_plan", data: { ...latest, revision: 1, content: "# old" } },
    { type: "message", message: { role: "user", content: "ignored" } },
    { type: "custom", customType: "eureka_plan", data: latest },
  ]);

  assert.equal(restored.revision, 2);
  assert.equal(restored.content, "# latest");
  assert.equal(restored.phase, "reviewing");
});

test("keeps approval when an older approved plan was temporarily switched back to planning", () => {
  const approved = {
    ...EMPTY_PLAN_STATE,
    phase: "executing",
    revision: 3,
    content: "# Goal\nKeep executing",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const temporarilyPlanning = {
    ...approved,
    phase: "planning",
    updatedAt: "2026-09-01T00:01:00.000Z",
  };
  const restored = readPlanState([
    { type: "custom", customType: "eureka_plan", data: approved },
    { type: "custom", customType: "eureka_plan", data: temporarilyPlanning },
  ]);

  assert.equal(restored.phase, "planning");
  assert.equal(restored.approvedAt, approved.updatedAt);
});

test("migrates a legacy single plan into a visible plan record", () => {
  const legacy = {
    ...EMPTY_PLAN_STATE,
    phase: "executing",
    content: "# Goal\nKeep history",
    sourceEntryId: "message-1",
    planModeActive: undefined,
    activePlanId: undefined,
  };
  const restored = readPlanState([{ type: "custom", customType: "eureka_plan", data: legacy }]);
  assert.equal(restored.planModeActive, false);
  assert.equal(restored.activePlanId, "legacy_0_message-1");
  assert.equal(getSessionPlans(restored).length, 1);
});

test("restores answered and pending clarification questions from the session state", () => {
  const state = {
    ...EMPTY_PLAN_STATE,
    phase: "planning",
    planModeActive: true,
    questions: [
      { id: "answered", toolCallId: "tool-1", title: "语言", question: "选择语言", options: [], status: "answered", answer: { text: "Python", custom: false }, askedAt: "2026-09-01T00:00:00.000Z" },
      { id: "pending", toolCallId: "tool-2", title: "范围", question: "选择范围", options: [], status: "pending", askedAt: "2026-09-01T00:01:00.000Z" },
    ],
  };
  const restored = readPlanState([{ type: "custom", customType: "eureka_plan", data: state }]);
  assert.equal(restored.questions.length, 2);
  assert.equal(getPendingPlanQuestion(restored)?.id, "pending");
});
