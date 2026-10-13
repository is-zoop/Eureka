import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { preserveRunningToolActivity } = await createJiti(import.meta.url).import("./agent-activity.ts");

test("message delivery preserves tools still executing in parallel", () => {
  const running = { kind: "running_tools", tools: [{ id: "a", name: "read" }, { id: "b", name: "bash" }] };
  assert.equal(preserveRunningToolActivity(running, null), running);
  assert.equal(preserveRunningToolActivity(running, { kind: "waiting_model" }), running);
  const remaining = { kind: "running_tools", tools: [running.tools[1]] };
  assert.equal(preserveRunningToolActivity(remaining, { kind: "waiting_model" }), remaining);
});

test("without active tools message events can move from model wait to streaming", () => {
  assert.equal(preserveRunningToolActivity({ kind: "waiting_model" }, null), null);
  const waiting = { kind: "waiting_model" };
  assert.equal(preserveRunningToolActivity(null, waiting), waiting);
  assert.equal(preserveRunningToolActivity({ kind: "running_tools", tools: [] }, waiting), waiting);
});
