import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const selection = await jiti.import("./plugin-selection.ts");
const drafts = await jiti.import("./draft-store.ts");
const display = await jiti.import("./slash-display.ts");
const recovery = await jiti.import("./prompt-recovery.ts");
const plugin = { source: "https://haze.example", capabilityId: "42", digest: "a".repeat(64), name: "Atlas数据助手" };

test("plugin selection survives per-draft recovery and promotion without duplication", () => {
  drafts.setDraft("one", { value: "查询", images: [], selectedPlugins: [plugin] });
  drafts.setDraft("two", { value: "另一条消息", images: [] });
  assert.equal(drafts.getDraft("two").selectedPlugins, undefined);
  const recovered = drafts.restoreDraftSubmission("one", "选数", [], [], [plugin]);
  assert.equal(recovered.selectedPlugins.length, 1);
  const moved = drafts.rekeyDraft("one", "session");
  assert.equal(moved.selectedPlugins[0].capabilityId, "42");
  assert.equal(drafts.getDraft("one"), null);
  moved.selectedPlugins[0].name = "changed";
  assert.equal(drafts.getDraft("session").selectedPlugins[0].name, plugin.name);
  drafts.clearDraft("session");
  assert.equal(drafts.getDraft("session"), null);
});
test("selection-only drafts are retained and independent references still merge", () => {
  drafts.setDraft("only", { value: "", images: [], selectedPlugins: [plugin] });
  assert.ok(drafts.getDraft("only"));
  const result = drafts.mergeRestoredSubmissionDraft("a", [], "b", [], [{ path: "a", isDir: false }], [{ path: "b", isDir: false }], [plugin], [plugin]);
  assert.equal(result.references.length, 2);
  assert.equal(result.selectedPlugins.length, 1);
});
test("stored selection envelope restores user text and keeps skill expansion compatible", () => {
  const text = selection.selectionEnvelope("你好", [plugin], "trusted context");
  assert.deepEqual(selection.splitPluginSelection(text), { text: "你好", plugins: [plugin], context: "trusted context" });
  assert.equal(selection.splitPluginSelection("ordinary <eureka-selected-plugins>text").plugins.length, 0);
  const skill = '<skill name="atlas-menu" location="/skills/atlas-menu/SKILL.md">\nReferences are relative to /skills/atlas-menu.\n\nOpen selection.\n</skill>';
  assert.equal(display.skillExpansionToCommand(selection.selectionEnvelope(skill, [plugin])), "/skill:atlas-menu");
  assert.equal(recovery.userMessageKey({ role: "user", content: text }), recovery.userMessageKey({ role: "user", content: "你好" }));
});

test("persistent selections survive send, refresh and promotion; once selections and other conversation drafts stay separate", async (t) => {
  const previousWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const persistent = { ...plugin, selectionMode: "persistent", subject: "user-a" };
  const once = { ...plugin, capabilityId: "other", selectionMode: "once" };
  const retained = selection.retainedPluginSelection([persistent, persistent, once]);
  assert.equal(retained.length, 1);
  drafts.setDraft("persistent-new", { value: "", images: [], selectedPlugins: retained });
  drafts.rekeyDraft("persistent-new", "persistent-chat");
  const freshJiti = createJiti(import.meta.url, { moduleCache: false });
  const freshDrafts = await freshJiti.import("./draft-store.ts");
  assert.equal(freshDrafts.getDraft("persistent-new"), null);
  assert.equal(freshDrafts.getDraft("persistent-chat").selectedPlugins[0].subject, "user-a");
  assert.equal(freshDrafts.getDraft("another-chat"), null);
  drafts.setDraft("persistent-chat", { value: "", images: [], selectedPlugins: [] });
  assert.equal(freshDrafts.getDraft("persistent-chat"), null, "explicit removal also clears the saved selection");
  storage.set("eureka-plugin-selection:malformed", '{"selectionMode":"persistent"}');
  assert.equal(freshDrafts.getDraft("malformed"), null);
});
