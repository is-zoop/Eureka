import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionHistory, buildSessionContext, SessionHistoryCursorError } = await jiti.import("./session-reader.ts");
const { mergeSessionHistory, projectSessionHistory, SessionHistoryRequests } = await jiti.import("./session-history.ts");

function conversation(turns = 25) {
  const entries = [];
  const append = value => entries.push({ timestamp: "2026-10-27T00:00:00.000Z", parentId: entries.at(-1)?.id ?? null, ...value });
  for (let index = 0; index < turns; index++) {
    append({ id: `u${index}`, type: "message", message: { role: "user", content: "same request" } });
    append({ id: `a${index}`, type: "message", message: { role: "assistant", content: [{ type: "text", text: `Answer ${index}` }], provider: "test", model: "test" } });
    if ([5, 10, 15, 20].includes(index)) append({ id: `c${index}`, type: "compaction", summary: `Summary ${index}`, firstKeptEntryId: `u${index}`, tokensBefore: 1000 });
  }
  return entries;
}

test("history traverses all pages in branch order while model context stays compacted", () => {
  const entries = conversation();
  const original = JSON.stringify(entries);
  const context = buildSessionContext(entries);
  let page = buildSessionHistory(entries);
  assert.equal(page.items.filter(item => item.message.role === "user").length, 10);
  assert.equal(page.items[0].entryId, "u15");
  let merged = page;
  while (page.hasMore) {
    page = buildSessionHistory(entries, entries.at(-1).id, { before: page.before });
    merged = mergeSessionHistory(page, merged);
  }
  assert.deepEqual(merged.items.map(item => item.entryId), entries.map(entry => entry.id));
  assert.equal(merged.items.filter(item => item.message.customType === "compaction").length, 4);
  assert.equal(merged.hasMore, false);
  assert.equal(merged.items.find(item => item.entryId === "u20").readOnly, true, "retained context before the marker is read-only history too");
  assert.equal(merged.items.find(item => item.entryId === "a21").readOnly, false);
  assert.deepEqual(buildSessionContext(entries), context);
  assert.equal(JSON.stringify(entries), original);
  assert.ok(context.messages.length < merged.items.length);
});

test("branch selection rejects foreign cursors and never includes sibling messages", () => {
  const entries = conversation(3);
  entries.push({ id: "other", parentId: "a0", type: "message", message: { role: "user", content: "another branch" } });
  const page = buildSessionHistory(entries, "other");
  assert.deepEqual(page.items.map(item => item.entryId), ["u0", "a0", "other"]);
  assert.throws(() => buildSessionHistory(entries, "other", { before: "a2" }), SessionHistoryCursorError);
  const changed = mergeSessionHistory(buildSessionHistory(entries, "a2"), page);
  assert.deepEqual(changed.items.map(item => item.entryId), ["u0", "a0", "other"]);
  assert.deepEqual(buildSessionHistory(entries, null).items, []);
});

test("compaction in the middle of a turn retains the user anchor, tools and original order", () => {
  const entries = conversation(1);
  entries[1].message.content = [{ type: "thinking", thinking: "private thought" }, { type: "toolCall", id: "tool", name: "read", arguments: { path: "file" } }];
  entries.push({ id: "c", parentId: "a0", type: "compaction", summary: "summary", firstKeptEntryId: "a0", tokensBefore: 100 });
  entries.push({ id: "r", parentId: "c", type: "message", message: { role: "toolResult", toolCallId: "tool", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }] } });
  const page = buildSessionHistory(entries, "r", { deferThinking: true, deferToolResultImages: true });
  assert.deepEqual(page.items.map(item => item.entryId), ["u0", "a0", "c", "r"]);
  assert.equal(page.items[1].message.content[0].deferred, true);
  assert.equal(page.items[1].message.content[0].thinking, "");
  assert.equal(page.items[3].message.content.some(block => block.type === "image"), false);
  assert.equal(entries[1].message.content[0].thinking, "private thought");
});

test("a new compaction preserves loaded pages and reclassifies old records as read-only", () => {
  const entries = conversation(4);
  const loaded = buildSessionHistory(entries);
  entries.push({ id: "new-compression", parentId: entries.at(-1).id, type: "compaction", summary: "compact", firstKeptEntryId: "u3", tokensBefore: 100 });
  const merged = mergeSessionHistory(loaded, buildSessionHistory(entries));
  assert.equal(merged.items.length, loaded.items.length + 1);
  assert.ok(merged.items.slice(0, -1).every(item => item.readOnly));
  assert.equal(merged.items.at(-1).readOnly, false);
});

test("editing the first post-compaction request targets the compressed boundary", () => {
  const entries = conversation(1);
  entries.push({ id: "compact", parentId: "a0", type: "compaction", summary: "summary", firstKeptEntryId: "a0", tokensBefore: 100 });
  entries.push({ id: "new-user", parentId: "compact", type: "message", message: { role: "user", content: "edit this request" } });
  const page = buildSessionHistory(entries);
  const user = page.items.at(-1);
  assert.equal(user.readOnly, false);
  assert.equal(user.editAnchorEntryId, "compact");
  assert.equal(buildSessionContext(entries, user.editAnchorEntryId).messages[0].customType, "compaction");
});

test("reconnect gaps are paged backwards without losing an already loaded prefix", () => {
  const entries = conversation(40);
  const old = buildSessionHistory(entries, "a3");
  let merged = mergeSessionHistory(old, buildSessionHistory(entries));
  assert.equal(merged.ranges.length, 2);
  assert.equal(merged.before, "u30");
  let requests = 0;
  while (merged.hasMore) {
    const earlier = buildSessionHistory(entries, merged.leafId, { before: merged.before });
    merged = mergeSessionHistory(earlier, merged);
    assert.ok(++requests < 10, "cursor must advance through the gap");
  }
  assert.deepEqual(merged.items.map(item => item.entryId), entries.map(entry => entry.id));
  assert.equal(merged.ranges.length, 1);
});

test("optimistic and SSE tail records keep distinct keys even when their text is identical", () => {
  const entries = conversation(1);
  const page = buildSessionHistory(entries);
  const runtime = buildSessionContext(entries);
  const one = { role: "user", content: "repeat" }, two = { role: "user", content: "repeat" };
  const keys = new WeakMap(); let id = 0;
  const key = message => { if (!keys.has(message)) keys.set(message, `temp-${++id}`); return keys.get(message); };
  const live = projectSessionHistory(page, runtime.messages.length, [...runtime.messages, one, two], runtime.entryIds, key);
  assert.equal(live.messages.length, page.items.length + 2);
  assert.notEqual(live.keys.at(-1), live.keys.at(-2));
  assert.deepEqual(projectSessionHistory(page, runtime.messages.length, [...runtime.messages, one, two], runtime.entryIds, key).keys, live.keys);
  const settled = projectSessionHistory(page, runtime.messages.length, runtime.messages, runtime.entryIds, key);
  assert.deepEqual(settled.entryIds, page.items.map(item => item.entryId));
});

test("late snapshots cannot replace a newer snapshot or a different branch", () => {
  const requests = new SessionHistoryRequests();
  const first = requests.begin();
  const second = requests.begin();
  assert.equal(requests.current(first), false);
  assert.equal(requests.current(second), true);
  requests.invalidate();
  assert.equal(requests.current(second), false);
  assert.equal(requests.current(requests.begin()), true);
});
