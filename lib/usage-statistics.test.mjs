import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, tsconfigPaths: true });
const { aggregateUsageStatistics } = await jiti.import("./usage-statistics.ts");

function assistantEntry({ id, timestamp, provider, model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost, toolCalls = 0 }) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      provider,
      model,
      content: Array.from({ length: toolCalls }, (_, index) => ({ type: "toolCall", toolCallId: `tool-${index}`, toolName: "read", input: {} })),
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        ...(cost === undefined ? {} : { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } }),
      },
    },
  };
}

test("aggregates usage by main project, provider, model, and day without exposing messages", () => {
  const source = [
    {
      info: { path: "E:/sessions/a.jsonl", id: "a", cwd: "E:/repo", projectRoot: "E:/repo", created: "2026-09-01", modified: "2026-09-10", messageCount: 1, firstMessage: "hidden" },
      entries: [assistantEntry({ id: "a1", timestamp: "2026-09-08T04:00:00.000Z", provider: "openai", model: "gpt", input: 100, output: 25, cacheRead: 75, cost: 1.5, toolCalls: 2 })],
    },
    {
      info: { path: "E:/sessions/b.jsonl", id: "b", cwd: "E:/repo-worktrees/feature", projectRoot: "E:/repo", worktreeBranch: "feature", created: "2026-09-01", modified: "2026-09-10", messageCount: 1, firstMessage: "hidden" },
      entries: [assistantEntry({ id: "b1", timestamp: "2026-09-09T04:00:00.000Z", provider: "anthropic", model: "sonnet", input: 50, output: 10, cacheWrite: 20, toolCalls: 1 })],
    },
  ];
  const result = aggregateUsageStatistics(source, "all");

  assert.equal(result.totals.total, 280);
  assert.equal(result.totals.cost, 1.5);
  assert.equal(result.totals.calls, 2);
  assert.equal(result.totals.usageCalls, 2);
  assert.equal(result.totals.costCalls, 1);
  assert.equal(result.totals.toolCalls, 3);
  assert.equal(result.totals.sessions, 2);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, "repo");
  assert.deepEqual(result.projects[0].models.map((model) => model.model).sort(), ["gpt", "sonnet"]);
  assert.equal(result.providers.length, 2);
  assert.equal(result.days.length, 2);
  assert.equal("message" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /hidden/);
});

test("limits rolling ranges while retaining all-history aggregates", () => {
  const today = new Date();
  const recent = new Date(today);
  recent.setDate(recent.getDate() - 2);
  const old = new Date(today);
  old.setDate(old.getDate() - 45);
  const source = [{
    info: { path: "E:/sessions/range.jsonl", id: "range", cwd: "E:/project", projectRoot: "E:/project", created: old.toISOString(), modified: today.toISOString(), messageCount: 2, firstMessage: "hidden" },
    entries: [
      assistantEntry({ id: "recent", timestamp: recent.toISOString(), provider: "openai", model: "gpt", input: 10, output: 1, cost: 0.1 }),
      assistantEntry({ id: "old", timestamp: old.toISOString(), provider: "openai", model: "gpt", input: 20, output: 2, cost: 0.2 }),
    ],
  }];
  const limited = aggregateUsageStatistics(source, "30d");
  assert.equal(limited.totals.calls, 1);
  assert.equal(limited.trendDays.length, 1);
  assert.equal(limited.days.length, 2);
  assert.equal(aggregateUsageStatistics(source, "all").totals.calls, 2);
});
