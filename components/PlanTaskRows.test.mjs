import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { getTaskStatus } = await jiti.import("./PlanTaskRows.tsx");

test("plan task rows derive status from persisted todo completion and the active stream", () => {
  assert.equal(getTaskStatus({ index: 1, text: "finished", done: true }, 2), "completed");
  assert.equal(getTaskStatus({ index: 2, text: "current", done: false }, 2), "running");
  assert.equal(getTaskStatus({ index: 3, text: "later", done: false }, 2), "pending");
});

test("completed todos take precedence over a stale inferred running index", () => {
  assert.equal(getTaskStatus({ index: 2, text: "already done", done: true }, 2), "completed");
});

test("advances the inferred running row to the first incomplete task", () => {
  const todos = [
    { index: 1, text: "one", done: true },
    { index: 2, text: "two", done: true },
    { index: 3, text: "three", done: false },
  ];
  assert.equal(getTaskStatus(todos[0], 3), "completed");
  assert.equal(getTaskStatus(todos[1], 3), "completed");
  assert.equal(getTaskStatus(todos[2], 3), "running");
});
