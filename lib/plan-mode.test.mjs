import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  EMPTY_PLAN_STATE,
  getPlanDoneIndexes,
  getPendingPlanQuestionGroup,
  getPlanQuestionOptionIds,
  validatePlanQuestionResponse,
  getSessionPlans,
  isDraftPlanEntry,
  isReviewablePlan,
  markPlanTodosDone,
  normalizePlanForReview,
  getPendingPlanQuestion,
  parsePlanTodos,
  readPlanState,
} = await jiti.import("./plan-mode.ts");

test("normalizes legacy single-choice answers and keeps grouped multiple-choice questions", () => {
  const state = {
    ...EMPTY_PLAN_STATE,
    planModeActive: true,
    questions: [
      { id: "legacy", toolCallId: "old", title: "Legacy", question: "Pick", options: [], status: "answered", answer: { optionId: "one", text: "One", custom: false }, askedAt: "now" },
      { id: "multi-a", toolCallId: "batch", title: "A", question: "Pick many", options: [], selection: "multiple", status: "pending", askedAt: "now" },
      { id: "multi-b", toolCallId: "batch", title: "B", question: "Pick one", options: [], selection: "single", status: "pending", askedAt: "now" },
    ],
  };
  const restored = readPlanState([{ type: "custom", customType: "eureka_plan", data: state }]);
  assert.deepEqual(getPlanQuestionOptionIds(restored.questions[0].answer), ["one"]);
  assert.equal(restored.questions[0].selection, "single");
  assert.equal(getPendingPlanQuestionGroup(restored).length, 2);
  assert.equal(getPendingPlanQuestionGroup(restored)[0].selection, "multiple");
});

test("validates multi-select, skipped, and invalid planning answers", () => {
  const multiple = { id: "multi", toolCallId: "batch", title: "Multiple", question: "Choose", selection: "multiple", status: "pending", askedAt: "now", options: [
    { id: "a", label: "A", description: "A" }, { id: "b", label: "B", description: "B" },
  ] };
  assert.deepEqual(validatePlanQuestionResponse(multiple, { questionId: "multi", optionIds: ["a", "b"] }), {
    optionId: undefined, optionIds: ["a", "b"], text: "A、B", custom: false, skipped: false,
  });
  assert.deepEqual(validatePlanQuestionResponse(multiple, { questionId: "multi", skipped: true }), {
    optionIds: [], text: "Skipped", custom: false, skipped: true,
  });
  assert.throws(() => validatePlanQuestionResponse({ ...multiple, selection: "single" }, { questionId: "multi", optionIds: ["a", "b"] }), /exactly one/);
  assert.throws(() => validatePlanQuestionResponse(multiple, { questionId: "multi", optionIds: ["missing"] }), /not available/);
});

test("only treats assistant replies after the plan-mode boundary as draft plans", () => {
  const entryIds = ["user-1", "assistant-1", "user-2", "assistant-2"];
  const state = {
    ...EMPTY_PLAN_STATE,
    phase: "planning",
    planModeActive: true,
    draftBoundaryEntryId: "assistant-1",
    draftBoundaryRecorded: true,
  };

  assert.equal(isDraftPlanEntry(state, entryIds, 1), false);
  assert.equal(isDraftPlanEntry(state, entryIds, 3), true);
  assert.equal(isDraftPlanEntry(state, ["assistant-after-pruned-boundary"], 0), true);
  assert.equal(isDraftPlanEntry({ ...state, draftBoundaryRecorded: false }, entryIds, 3), false);
});

test("recovers a missing draft boundary for an active legacy plan with clarifications", () => {
  const activePlanId = "legacy-active-plan";
  const legacyPlanning = {
    ...EMPTY_PLAN_STATE,
    phase: "planning",
    planModeActive: true,
    activePlanId,
    draftBoundaryEntryId: undefined,
    draftBoundaryRecorded: undefined,
  };
  const restored = readPlanState([
    { type: "message", id: "before-plan", message: { role: "user", content: "plan this" } },
    { type: "custom", customType: "eureka_plan", data: legacyPlanning },
    { type: "message", id: "question-call", message: { role: "assistant", content: [] } },
    { type: "message", id: "answer", message: { role: "user", content: "answered" } },
    { type: "custom", customType: "eureka_plan", data: { ...legacyPlanning, questions: [{ id: "q1", toolCallId: "tool", title: "Q", question: "Q?", options: [], status: "answered", askedAt: "now" }] } },
  ]);

  assert.equal(restored.draftBoundaryRecorded, true);
  assert.equal(restored.draftBoundaryEntryId, "before-plan");
  assert.equal(isDraftPlanEntry(restored, ["before-plan", "question-call", "answer", "new-plan"], 3), true);
  assert.equal(isDraftPlanEntry(restored, ["before-plan", "question-call", "answer", "new-plan"], 0), false);
});

test("extracts a stable implementation checklist from Markdown", () => {
  assert.deepEqual(parsePlanTodos("# Goal\n- Describe the outcome\n\n# Implementation steps\n- [ ] add endpoint\n- [x] existing work\n\n# Risks\n- A risk, not work\n\n# Verification\n* [ ] verify behavior"), [
    { index: 1, text: "add endpoint", done: false },
    { index: 2, text: "existing work", done: true },
    { index: 3, text: "verify behavior", done: false },
  ]);
});

test("only marks checklist items named by DONE markers", () => {
  const todos = parsePlanTodos("# Implementation steps\n- [ ] one\n- [ ] two\n\n# Verification\n- [ ] three");
  assert.deepEqual(markPlanTodosDone(todos, "Completed the first item [DONE:1] and third [DONE:3]."), [
    { index: 1, text: "one", done: true },
    { index: 2, text: "two", done: false },
    { index: 3, text: "three", done: true },
  ]);
});

test("normalizes streamed DONE markers into a stable, deduplicated progress signature", () => {
  assert.deepEqual(getPlanDoneIndexes("[DONE:3] partial [DONE:1] repeated [DONE:3]"), [1, 3]);
});

test("accepts only a structured plan for review", () => {
  assert.equal(isReviewablePlan("# 目标\n实现图片调整。\n\n# 实施步骤\n- [ ] 新增处理逻辑\n\n# 验证\n- [ ] 运行测试"), true);
  assert.equal(isReviewablePlan("下面是完整脚本：\n```python\nprint('hello')\n```"), false);
});

test("a post-clarification plan with ordinary verification bullets is reviewable and tracks verification", () => {
  const content = "## Goal\n落实已确认的菜单权限。\n\n## Affected areas\n- 前后端授权\n\n## Implementation steps\n- [ ] 实现权限检查\n\n## Risks\n- 保留业务读取能力\n\n## Verification\n- 验证四种角色的访问权限\n- 运行权限回归测试";
  assert.equal(isReviewablePlan(content), true);
  const normalized = normalizePlanForReview(content);
  assert.match(normalized, /## Verification\n- \[ \] 验证四种角色的访问权限\n- \[ \] 运行权限回归测试/);
  assert.match(normalized, /## Affected areas\n- 前后端授权/);
  assert.match(normalized, /## Risks\n- 保留业务读取能力/);
  assert.equal(normalizePlanForReview(normalized), normalized);
  assert.deepEqual(parsePlanTodos(normalized), [
    { index: 1, text: "实现权限检查", done: false },
    { index: 2, text: "验证四种角色的访问权限", done: false },
    { index: 3, text: "运行权限回归测试", done: false },
  ]);
});

test("normalizes Chinese numbered verification without rewriting checked tasks or fenced examples", () => {
  const content = "# 目标：\n修复页面\n# 实施步骤\n- [ ] 实现修复\n# 验证方式：\n1. 验证页面\n- [x] 已完成检查\n```markdown\n- 示例，不是任务\n```\n* 再次检查";
  assert.equal(isReviewablePlan(content), true);
  const normalized = normalizePlanForReview(content);
  assert.match(normalized, /- \[ \] 验证页面\n- \[x\] 已完成检查/);
  assert.match(normalized, /```markdown\n- 示例，不是任务\n```/);
  assert.deepEqual(parsePlanTodos(normalized).map((todo) => todo.text), ["实现修复", "验证页面", "已完成检查", "再次检查"]);
});

test("clarifications, incomplete plans and checklist examples cannot be submitted as plans", () => {
  assert.equal(isReviewablePlan("已回答规划澄清：\n- 确认范围：数据源菜单"), false);
  assert.equal(isReviewablePlan("# Goal\n修复\n# Implementation steps\n稍后制定\n# Verification\n- 运行测试"), false);
  assert.equal(isReviewablePlan("# Goal\n修复\n# Implementation steps\n- [ ] 修改\n# Verification\n稍后确定\n# Risks\n- [ ] 风险不是验证"), false);
  assert.equal(isReviewablePlan("```markdown\n# Goal\n示例\n# Implementation steps\n- [ ] 示例步骤\n# Verification\n- [ ] 示例验证\n```"), false);
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

test("normalizes legacy progress without counting risk bullets", () => {
  const legacy = {
    ...EMPTY_PLAN_STATE,
    phase: "executing",
    content: "# 实施步骤\n- [ ] 创建页面\n\n# Risks\n- 浮点数精度\n\n# 验证\n- [ ] 验证结果",
    todos: [
      { index: 1, text: "创建页面", done: true },
      { index: 2, text: "浮点数精度", done: false },
      { index: 3, text: "验证结果", done: false },
    ],
  };
  const restored = readPlanState([{ type: "custom", customType: "eureka_plan", data: legacy }]);
  assert.deepEqual(restored.todos, [
    { index: 1, text: "创建页面", done: true },
    { index: 2, text: "验证结果", done: false },
  ]);
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

test("normalizes a cancelled planning state back to an ordinary chat", () => {
  const cancelled = {
    ...EMPTY_PLAN_STATE,
    phase: "planning",
    planModeActive: false,
    activePlanId: "cancelled-plan",
    content: "# Goal\nAbandoned draft",
    sourceEntryId: "message-2",
  };
  const restored = readPlanState([{ type: "custom", customType: "eureka_plan", data: cancelled }]);
  assert.equal(restored.phase, "idle");
  assert.equal(restored.planModeActive, false);
  assert.equal(getSessionPlans(restored).length, 1);
  assert.equal(getSessionPlans(restored)[0]?.activePlanId, "cancelled-plan");
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
