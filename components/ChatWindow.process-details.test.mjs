import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { phaseExpanded } = await jiti.import("./TaskTurnView.tsx");

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("keeps unfinished phases expanded when a settled turn has no final answer", () => {
  assert.equal(phaseExpanded("incomplete"), true);
  assert.match(source, /<TaskTurnView/);
});

test("keeps every persisted plan viewable after plan mode ends", () => {
  assert.match(source, /const currentPlanAction = Boolean\(sourcePlan && onOpenPlanReview\)/);
  assert.match(source, /!sourcePlanIsCurrent \|\| sourcePlan\.phase !== "reviewing"/);
});

test("does not render a plan card inside a split final response's process details", () => {
  assert.match(source, /options\.renderPlan === false \|\| !entryIds\[idx\]\s*\? undefined/);
  assert.match(source, /summaryExcludedMessageIndices: protectedPlanIndices/);
  assert.match(source, /keyPrefix: "final-answer"/);
});

test("only offers submission for a reviewable assistant plan, not clarification prose", () => {
  assert.match(source, /const canSubmitPlan[\s\S]*?isReviewablePlan\(getAssistantText\(msg as AssistantMessage\)\)/);
});
