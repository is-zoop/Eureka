import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { getStoredThinkingPreview, rememberThinkingPreview, rememberMessageThinkingPreviews,
  observeThinkingPreviewEvent, transferThinkingPreviews } = await createJiti(import.meta.url).import("./thinking-preview-cache.ts");

test("streamed summaries survive folding before the thought row is ever opened", () => {
  observeThinkingPreviewEvent("live-fold", 1000, { type: "thinking_start", contentIndex: 1 });
  observeThinkingPreviewEvent("live-fold", 1000, { type: "thinking_delta", contentIndex: 1, delta: "**Formulating query " });
  observeThinkingPreviewEvent("live-fold", 1000, { type: "thinking_delta", contentIndex: 1, delta: "for shop and category metrics**" });
  observeThinkingPreviewEvent("live-fold", 1000, { type: "thinking_end", contentIndex: 1, content: "**Formulating query for shop and category metrics**" });
  assert.equal(getStoredThinkingPreview("live-fold", 1000, 1), "Formulating query for shop and category metrics");
  rememberMessageThinkingPreviews("live-fold", { timestamp: 1000, content: [{ type: "text", text: "" },
    { type: "thinking", thinking: "", deferred: true, preview: "" }] }, "saved-entry");
  assert.equal(getStoredThinkingPreview("live-fold", undefined, 1, "saved-entry"), "Formulating query for shop and category metrics");
  assert.equal(getStoredThinkingPreview("other-session", 1000, 1, "saved-entry"), undefined);
  assert.equal(getStoredThinkingPreview("live-fold", 1000, 2), undefined);
});

test("empty completion payloads and provider timestamp replacement retain the streamed excerpt", () => {
  observeThinkingPreviewEvent("changed-time", 2000, { type: "thinking_delta", contentIndex: 0, delta: "**Checking totals**" });
  observeThinkingPreviewEvent("changed-time", 2000, { type: "thinking_end", contentIndex: 0, content: "" });
  transferThinkingPreviews("changed-time", 2000, 2100);
  rememberMessageThinkingPreviews("changed-time", { timestamp: 2100, content: [{ type: "thinking", thinking: "", deferred: true }] }, "new-entry");
  assert.equal(getStoredThinkingPreview("changed-time", 2100, 0, "new-entry"), "Checking totals");
});

test("reconnect snapshots seed deltas and stale empty previews do not erase readable text", () => {
  rememberMessageThinkingPreviews("snapshot", { timestamp: 3000, content: [{ type: "thinking", thinking: "**Checking " }] }, undefined, true);
  observeThinkingPreviewEvent("snapshot", 3000, { type: "thinking_delta", contentIndex: 0, delta: "the result**" });
  rememberThinkingPreview("snapshot", 3000, 0, "");
  assert.equal(getStoredThinkingPreview("snapshot", 3000, 0), "Checking the result");
});
