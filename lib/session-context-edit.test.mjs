import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager, buildSessionContext as sdkContext } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, buildSessionHistory } = await jiti.import("./session-reader.ts");
const user = (content) => ({ role: "user", content, timestamp: Date.now() });
const content = (ctx, id) => ctx.messages[ctx.entryIds.indexOf(id)]?.content;

test("context edits replace or omit model content without changing audit history or entry IDs", () => {
  const manager = SessionManager.inMemory();
  const first = manager.appendMessage(user("Original request"));
  const second = manager.appendMessage(user("Omitted request"));
  manager.appendContextEdit(first, { content: "Short request" });
  manager.appendContextEdit(second, null);
  const entries = manager.getEntries();
  const before = JSON.stringify(entries);
  const ctx = buildSessionContext(entries);
  assert.equal(content(ctx, first), "Short request");
  assert.ok(!ctx.entryIds.includes(second));
  assert.equal(ctx.messages.length, ctx.entryIds.length);
  const history = buildSessionHistory(entries);
  assert.equal(JSON.stringify(entries), before);
  assert.match(JSON.stringify(history), /Original request/);
  assert.match(JSON.stringify(history), /Omitted request/);
});

test("edits are scoped to the selected branch and are not retroactive when navigating", () => {
  const manager = SessionManager.inMemory();
  const root = manager.appendMessage(user("Root"));
  const edited = manager.appendContextEdit(root, { content: "Branch A" });
  manager.branch(root);
  const sibling = manager.appendMessage(user("Branch B"));
  const entries = manager.getEntries();
  assert.equal(content(buildSessionContext(entries, edited), root), "Branch A");
  assert.equal(content(buildSessionContext(entries, sibling), root), "Root");
  assert.equal(content(buildSessionContext(entries, root), root), "Root");
});

test("edits survive compaction and reopening while retaining the SDK system/tool checkpoint", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-context-edit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir);
  manager.appendMessage({ role: "system", content: "Checkpoint prompt", toolsAdded: [{ name: "fixture", description: "Fixture", parameters: { type: "object" } }], timestamp: Date.now() });
  manager.appendMessage(user("Old request"));
  const kept = manager.appendMessage(user("Retained original"));
  manager.appendContextEdit(kept, { content: "Before compaction" });
  manager.appendCompaction("Older context summary", kept, 500);
  const compactedLeaf = manager.getLeafId();
  manager.appendContextEdit(kept, { content: "After compaction" });
  const entries = SessionManager.open(manager.getSessionFile()).getEntries();
  assert.equal(content(buildSessionContext(entries, compactedLeaf), kept), "Before compaction");
  const ui = buildSessionContext(entries);
  assert.equal(content(ui, kept), "After compaction");
  assert.ok(ui.messages.every((message) => message.role !== "system"));
  const sdk = sdkContext(entries);
  assert.equal(getCurrentSystemPrompt(sdk.messages), "Checkpoint prompt");
  assert.deepEqual(getCurrentTools(sdk.messages).map((tool) => tool.name), ["fixture"]);
  assert.equal(buildSessionHistory(entries).items.some((item) => item.message?.role === "system"), false);
});

test("custom message edits preserve display metadata for collapsed messages", () => {
  const manager = SessionManager.inMemory();
  const shown = manager.appendCustomMessageEntry("fixture", "Original custom", true, { marker: true });
  manager.appendContextEdit(shown, { content: "Edited custom" });
  const hidden = manager.appendCustomMessageEntry("hidden", "Hidden custom", false);
  manager.appendContextEdit(hidden, { content: "Still hidden" });
  const ctx = buildSessionContext(manager.getEntries());
  assert.match(JSON.stringify(content(ctx, shown)), /Edited custom/);
  assert.equal(content(ctx, hidden), "Still hidden");
  assert.equal(ctx.messages[ctx.entryIds.indexOf(hidden)].display, false);
});
