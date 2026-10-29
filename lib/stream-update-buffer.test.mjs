import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { StreamUpdateBuffer } = await jiti.import("./stream-update-buffer.ts");
const { streamReducer, INITIAL_STREAMING_STATE } = await jiti.import("./streaming-message.ts");
const text = (delta) => ({ type: "delta", event: { type: "text_delta", contentIndex: 0, delta } });
const snapshot = (value) => ({ type: "snapshot", message: {
  role: "assistant", content: [{ type: "text", text: value }], timestamp: 1,
} });

function harness() {
  const emitted = [];
  let state = INITIAL_STREAMING_STATE;
  let scheduled;
  let scheduledCount = 0;
  const buffer = new StreamUpdateBuffer((action) => {
    emitted.push(action);
    state = streamReducer(state, action);
  }, (flush) => {
    scheduled = flush;
    scheduledCount++;
    return () => { scheduled = undefined; };
  });
  return { buffer, emitted, get state() { return state; }, get scheduledCount() { return scheduledCount; },
    tick() { scheduled?.(); }, get scheduled() { return scheduled; } };
}

test("many transport deltas produce one UI update with the complete original text", () => {
  const h = harness();
  h.buffer.send(snapshot(""));
  for (const character of "中文 👨‍👩‍👧‍👦 stream") h.buffer.send(text(character));
  assert.equal(h.emitted.length, 1);
  assert.equal(h.scheduledCount, 1);
  h.tick();
  assert.equal(h.emitted.length, 2);
  assert.equal(h.state.streamingMessage.content[0].text, "中文 👨‍👩‍👧‍👦 stream");
  assert.equal(h.scheduled, undefined);
});

test("text_end flushes queued deltas before applying the authoritative content", () => {
  const h = harness();
  h.buffer.send(snapshot(""));
  h.buffer.send(text("partial"));
  h.buffer.send({ type: "delta", event: { type: "text_end", contentIndex: 0, content: "Complete." } });
  assert.deepEqual(h.emitted.map((action) => action.type), ["snapshot", "batch", "delta"]);
  assert.equal(h.state.streamingMessage.content[0].text, "Complete.");
  h.tick();
  assert.equal(h.state.streamingMessage.content[0].text, "Complete.");
});

test("completion, reconnect snapshots and new runs discard queued stale text", () => {
  for (const boundary of [{ type: "end" }, { type: "start" }, snapshot("fresh")]) {
    const h = harness();
    h.buffer.send(snapshot(""));
    h.buffer.send(text("stale"));
    h.buffer.send(boundary);
    h.tick();
    assert.equal(h.emitted.length, 2);
    assert.equal(h.scheduled, undefined);
    if (boundary.type === "snapshot") assert.equal(h.state.streamingMessage.content[0].text, "fresh");
    else assert.equal(h.state.streamingMessage, null);
  }
});

test("tool execution is ordered after pending thinking and cleanup cancels outstanding work", () => {
  const h = harness();
  h.buffer.send({ type: "snapshot", message: { role: "assistant", content: [{ type: "thinking", thinking: "" }] } });
  h.buffer.send({ type: "delta", event: { type: "thinking_delta", contentIndex: 0, delta: "Plan" } });
  h.buffer.send({ type: "delta", event: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "t", name: "read", arguments: { path: "x" } } } });
  assert.deepEqual(h.state.streamingMessage.content, [
    { type: "thinking", thinking: "Plan" },
    { type: "toolCall", toolCallId: "t", toolName: "read", input: { path: "x" } },
  ]);
  h.buffer.send(text("discard"));
  h.buffer.clear();
  h.tick();
  assert.equal(h.scheduled, undefined);
  assert.equal(h.emitted.length, 3);
});
