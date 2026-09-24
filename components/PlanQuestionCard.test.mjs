import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("planning question card provides grouped navigation and delayed batch submission", async () => {
  const source = await readFile(new URL("./PlanQuestionCard.tsx", import.meta.url), "utf8");

  assert.match(source, /max-w-none/);
  assert.match(source, /text-\[13px\] font-medium leading-5 text-\[var\(--text-dim\)\]/);
  assert.match(source, /plan-question-choice-control/);
  assert.match(source, /data-selected/);
  assert.match(source, /useTheme/);
  assert.match(source, /borderColor: "#c8c8c8"/);
  assert.match(source, /AUTO_ADVANCE_MS/);
  assert.match(source, /question\.selection === "multiple"/);
  assert.match(source, /skipped: true/);
  assert.match(source, /questions\.map\(\(question\) => responseFor/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /RollingCounter/);
});
