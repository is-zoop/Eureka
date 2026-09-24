import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("keeps every persisted plan viewable after plan mode ends", () => {
  assert.match(source, /const currentPlanAction = Boolean\(sourcePlan && onOpenPlanReview\)/);
  assert.match(source, /!sourcePlanIsCurrent \|\| sourcePlan\.phase !== "reviewing"/);
});

test("does not render a plan card inside a split final response's process details", () => {
  assert.match(source, /options\.renderPlan === false\s*\? undefined/);
  assert.match(
    source,
    /keyPrefix: "process-final", messageOverride: finalProcessMessage, showTimestamp: false, renderPlan: false/,
  );
});
