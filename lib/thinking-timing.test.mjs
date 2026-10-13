import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { thinkingTimingKey, getThinkingTiming, getMessageThinkingTiming, bindMessageThinkingTimings, observeThinkingEvent, observeThinkingSnapshot, finishMessageThinking, estimateThinkingSeconds, startThinkingTiming, finishThinkingTiming, rememberThinkingDuration, transferMessageThinking } = await createJiti(import.meta.url).import("./thinking-timing.ts");

test("history binds exact live timings to the permanent entry and preserves them over generation estimates", () => {
  const message = { timestamp: 1000, generationCompletedAt: 12000, content: [{ type: "thinking", thinking: "one" }] };
  observeThinkingEvent("entry-binding", 1000, { type: "thinking_start", contentIndex: 0 }, 1500);
  observeThinkingEvent("entry-binding", 1000, { type: "thinking_end", contentIndex: 0 }, 3700);
  bindMessageThinkingTimings("entry-binding", message, "original");
  bindMessageThinkingTimings("entry-binding", { ...message, timestamp: 1100 }, "original");
  assert.deepEqual(getMessageThinkingTiming("entry-binding", undefined, 0, "original"),
    { startedAt: 1500, finishedAt: 3700, estimated: false });
});

test("completion metadata survives absent tree timestamps and repeated history hydration", () => {
  const message = { timestamp: 1791875229811, generationCompletedAt: 1791875232152,
    content: [{ type: "thinking", thinking: "", deferred: true }] };
  assert.equal(estimateThinkingSeconds(message), 2);
  bindMessageThinkingTimings("compressed-history", message, "a5920d7e");
  bindMessageThinkingTimings("compressed-history", { ...message, generationCompletedAt: undefined }, "a5920d7e");
  assert.deepEqual(getMessageThinkingTiming("compressed-history", undefined, 0, "a5920d7e"),
    { startedAt: 0, finishedAt: 2000, estimated: true });
});

test("measures thinking boundaries independently of text and tool execution", () => {
  const key = thinkingTimingKey("exact", 100, 0);
  observeThinkingEvent("exact", 100, { type: "thinking_start", contentIndex: 0 }, 1000);
  observeThinkingEvent("exact", 100, { type: "thinking_delta", contentIndex: 0 }, 2000);
  observeThinkingEvent("exact", 100, { type: "thinking_end", contentIndex: 0 }, 5200);
  finishMessageThinking("exact", 100, 14000);
  assert.deepEqual(getThinkingTiming(key), { startedAt: 1000, finishedAt: 5200, estimated: false });
});

test("a successor ends thinking even when a provider omits thinking_end", () => {
  observeThinkingEvent("successor", 200, { type: "thinking_start", contentIndex: 1 }, 1000);
  observeThinkingEvent("successor", 200, { type: "text_start", contentIndex: 2 }, 3600);
  assert.equal(getThinkingTiming(thinkingTimingKey("successor", 200, 1)).finishedAt, 3600);
});

test("replayed events retain the original measured time and isolated message identities", () => {
  observeThinkingEvent("replay", 300, { type: "thinking_start", contentIndex: 0 }, 1000);
  observeThinkingEvent("replay", 300, { type: "thinking_start", contentIndex: 0 }, 1800);
  observeThinkingEvent("replay", 300, { type: "thinking_end", contentIndex: 0 }, 2000);
  observeThinkingEvent("replay", 300, { type: "thinking_end", contentIndex: 0 }, 9000);
  assert.deepEqual(getThinkingTiming(thinkingTimingKey("replay", 300, 0)), { startedAt: 1000, finishedAt: 2000, estimated: false });
  assert.equal(getThinkingTiming(thinkingTimingKey("other", 300, 0)), undefined);
});

test("reconnect observations are explicitly approximate", () => {
  observeThinkingSnapshot("reconnect", { timestamp: 400, content: [{ type: "thinking", thinking: "partial" }] }, 1000);
  finishMessageThinking("reconnect", 400, 5500);
  assert.equal(getThinkingTiming(thinkingTimingKey("reconnect", 400, 0)).estimated, true);
});

test("settlement freezes unfinished thinking without overwriting an exact end", () => {
  observeThinkingEvent("settle", 500, { type: "thinking_start", contentIndex: 0 }, 1000);
  finishMessageThinking("settle", 500, 4100, true);
  finishMessageThinking("settle", 500, 9000, true);
  assert.deepEqual(getThinkingTiming(thinkingTimingKey("settle", 500, 0)), { startedAt: 1000, finishedAt: 4100, estimated: true });
  observeThinkingEvent("settle-exact", 501, { type: "thinking_start", contentIndex: 0 }, 1000);
  observeThinkingEvent("settle-exact", 501, { type: "thinking_end", contentIndex: 0 }, 3000);
  finishMessageThinking("settle-exact", 501, 9000, true);
  assert.deepEqual(getThinkingTiming(thinkingTimingKey("settle-exact", 501, 0)), { startedAt: 1000, finishedAt: 3000, estimated: false });
});

test("old messages use generation timestamps only when one thinking block exists", () => {
  const message = { timestamp: 1000, content: [{ type: "thinking", thinking: "one" }, { type: "text", text: "answer" }] };
  assert.equal(estimateThinkingSeconds(message, 4200), 3);
  assert.equal(estimateThinkingSeconds(message, 900), undefined);
  assert.equal(estimateThinkingSeconds(message, undefined), undefined);
  assert.equal(estimateThinkingSeconds({ ...message, content: [...message.content, { type: "thinking", thinking: "two" }] }, 4200), undefined);
});

test("fallback observations and historical estimates survive removal of their rendering component", () => {
  const key = thinkingTimingKey("fallback-render", 800, 2);
  startThinkingTiming(key, 1000, true);
  finishThinkingTiming(key, 7400, true);
  assert.deepEqual(getThinkingTiming(key), { startedAt: 1000, finishedAt: 7400, estimated: true });
  startThinkingTiming(key, 9000, true);
  finishThinkingTiming(key, 15000, true);
  assert.equal(getThinkingTiming(key).finishedAt, 7400);
  const historicalKey = thinkingTimingKey("historical-render", undefined, 3, "original-entry");
  rememberThinkingDuration(historicalKey, 6);
  rememberThinkingDuration(historicalKey, undefined);
  assert.deepEqual(getThinkingTiming(historicalKey), { startedAt: 0, finishedAt: 6000, estimated: true });
});

test("provider timestamp replacement retains each original thought's exact duration", () => {
  observeThinkingEvent("replacement", 900, { type: "thinking_start", contentIndex: 0 }, 1000);
  observeThinkingEvent("replacement", 900, { type: "thinking_end", contentIndex: 0 }, 3200);
  observeThinkingEvent("replacement", 900, { type: "thinking_start", contentIndex: 2 }, 5000);
  finishMessageThinking("replacement", 900, 8000);
  transferMessageThinking("replacement", 900, 901);
  assert.deepEqual(getThinkingTiming(thinkingTimingKey("replacement", 901, 0)), { startedAt: 1000, finishedAt: 3200, estimated: false });
  assert.deepEqual(getThinkingTiming(thinkingTimingKey("replacement", 901, 2)), { startedAt: 5000, finishedAt: 8000, estimated: false });
});

test("completed durations survive a fresh module load and unavailable browser storage", async () => {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  try {
    const freshImport = () => createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import("./thinking-timing.ts");
    const first = await freshImport();
    const key = first.thinkingTimingKey("persisted", 1001, 1);
    first.startThinkingTiming(key, 2000);
    first.finishThinkingTiming(key, 10500);
    const second = await freshImport();
    assert.deepEqual(second.getThinkingTiming(key), { startedAt: 2000, finishedAt: 10500, estimated: false });
    window.localStorage.setItem = () => { throw new Error("storage disabled"); };
    second.startThinkingTiming("memory-only", 1000);
    second.finishThinkingTiming("memory-only", 2000);
    assert.equal(second.getThinkingTiming("memory-only").finishedAt, 2000);
  } finally {
    delete globalThis.window;
  }
});
