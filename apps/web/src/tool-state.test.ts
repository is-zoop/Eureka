import { describe, expect, it } from "vitest";
import { endTool, startTool, toggleTool, updateTool } from "./tool-state.js";

const execution = { id: "bash-1", name: "Bash", input: { command: "npm test" }, status: "running" as const, startedAt: 1 };

describe("tool state", () => {
it("merges streamed output and collapses after completion", () => {
  const started = startTool({}, execution);
  expect(started["bash-1"].open).toBe(true);
  const updated = updateTool(started, "bash-1", "one\n");
  const ended = endTool(updated, "bash-1", true, { content: "done" }, 2);
  expect(ended["bash-1"].delta).toBe("one\n");
  expect(ended["bash-1"].execution.status).toBe("success");
  expect(ended["bash-1"].execution.finishedAt).toBe(2);
  expect(ended["bash-1"].open).toBe(false);
});

it("keeps a manually expanded tool open after completion", () => {
  const started = startTool({}, execution);
  const expanded = toggleTool(toggleTool(started, "bash-1"), "bash-1");
  const ended = endTool(expanded, "bash-1", false, { content: "failed" }, 3);
  expect(ended["bash-1"].open).toBe(true);
  expect(ended["bash-1"].execution.status).toBe("error");
});
});
