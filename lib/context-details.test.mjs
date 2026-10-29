import assert from "node:assert/strict";
import test from "node:test";
import { buildContextDetails, contextCapacity, estimateMessageTokens, estimateTextTokens } from "./context-details.ts";

const message = { role: "user", content: "hello context" };
const base = { sessionId: "one", source: "live", messages: [message], contextWindow: 1000 };
const sum = (details) => details.breakdown.reduce((total, part) => total + (part.tokens ?? 0), 0);

test("live categories share the current usage total and separate the skill catalog", () => {
  const details = buildContextDetails({ ...base, systemPrompt: "instructions <available_skills>catalog</available_skills>", tools: [{ name: "read", description: "Read a file", parameters: { type: "object" } }], usage: { tokens: 600, contextWindow: 1000, percent: 60 }, reserveTokens: 100 });
  assert.equal(details.usage.tokens, 600);
  assert.equal(details.usage.percent, 60);
  assert.equal(details.usageEstimated, false);
  assert.equal(sum(details), 600);
  assert.ok(details.breakdown.find((part) => part.id === "skills").tokens > 0);
  assert.ok(details.breakdown.find((part) => part.id === "system").tokens > 0);
  assert.deepEqual(contextCapacity(details.usage, details.reserveTokens), { used: 600, free: 400, reserved: 100, available: 300 });
  assert.doesNotMatch(JSON.stringify(details), /instructions|catalog|Read a file|hello context/);
});

test("post-compaction missing usage is estimated from the new messages", () => {
  const details = buildContextDetails({ ...base, systemPrompt: "", tools: [], usage: { tokens: null, contextWindow: 1000, percent: null } });
  assert.equal(details.usageEstimated, true);
  assert.equal(details.usage.estimated, true);
  assert.equal(details.usage.tokens, estimateMessageTokens([message]));
  assert.equal(details.breakdown.find((part) => part.id === "tools").tokens, 0);
  assert.equal(sum(details), details.usage.tokens);
});

test("history leaves unavailable runtime categories unknown instead of inventing exact counts", () => {
  const details = buildContextDetails({ ...base, source: "history", usage: { tokens: 800, contextWindow: 1000, percent: 80 }, canCompact: false });
  for (const id of ["system", "tools", "skills"]) assert.equal(details.breakdown.find((part) => part.id === id).tokens, null);
  assert.equal(details.canCompact, false);
  assert.equal(sum(details), 800);
  assert.ok(details.breakdown.find((part) => part.id === "other").tokens > 0);
});

test("estimated history messages cannot overflow a reported context total", () => {
  const details = buildContextDetails({ ...base, usage: { tokens: 1, contextWindow: 1000, percent: null } });
  assert.equal(sum(details), 1);
  assert.equal(details.breakdown.find((part) => part.id === "messages").tokens, 1);
});

test("capacity handles over-limit contexts and an unknown model window", () => {
  assert.deepEqual(contextCapacity({ tokens: 1200, contextWindow: 1000, percent: 120 }, 200), { used: 1200, free: 0, reserved: 0, available: 0 });
  assert.equal(contextCapacity({ tokens: null, contextWindow: 1000, percent: null }, 200).available, null);
  const unknown = buildContextDetails({ ...base, contextWindow: undefined, reserveTokens: 100 });
  assert.equal(unknown.usage.contextWindow, 0);
  assert.equal(unknown.usage.percent, null);
  assert.equal(contextCapacity(unknown.usage, unknown.reserveTokens).available, null);
});

test("text estimates handle CJK and do not count image base64 as text tokens", () => {
  assert.equal(estimateTextTokens("你好abcd"), 3);
  assert.equal(estimateTextTokens(""), 0);
  const one = estimateMessageTokens([{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", data: "x" }] }]);
  const many = estimateMessageTokens([{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", data: "x".repeat(100000) }] }]);
  assert.equal(one, many);
});

test("invalid numeric usage is estimated and never leaks NaN into the response", () => {
  const details = buildContextDetails({ ...base, usage: { tokens: NaN, contextWindow: Infinity, percent: NaN }, reserveTokens: NaN });
  assert.equal(details.usageEstimated, true);
  assert.equal(details.usage.tokens, estimateMessageTokens([message]));
  assert.equal(details.usage.contextWindow, 0);
  assert.equal(details.reserveTokens, null);
  assert.doesNotMatch(JSON.stringify(details), /NaN|Infinity/);
});
