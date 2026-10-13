import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { loadThinkingContent, getCachedThinkingPreview } = await createJiti(import.meta.url).import("./thinking-content.ts");

test("reading a thought preview does not fetch; after opening, reopening retains the preview and request", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ thinking: "**查询数据**\n\n核对结果。" }) };
  };
  try {
    assert.equal(getCachedThinkingPreview("session", "original-entry", 3), undefined);
    assert.equal(requests.length, 0);
    const first = loadThinkingContent("session", "original-entry", 3);
    assert.equal(await first, "**查询数据**\n\n核对结果。");
    assert.equal(getCachedThinkingPreview("session", "original-entry", 3), "查询数据 核对结果。");
    const reopened = loadThinkingContent("session", "original-entry", 3);
    assert.equal(reopened, first);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /entries\/original-entry\/thinking\?blockIndex=3$/);
    assert.equal(getCachedThinkingPreview("session", "other-entry", 3), undefined);
  } finally { globalThis.fetch = previousFetch; }
});

test("failed thinking loads can retry without retaining an empty or erroneous preview", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1
    ? { ok: false, status: 503 }
    : { ok: true, json: async () => ({ thinking: "Recovered content" }) });
  try {
    await assert.rejects(loadThinkingContent("retry", "entry", 0), /503/);
    assert.equal(getCachedThinkingPreview("retry", "entry", 0), undefined);
    assert.equal(await loadThinkingContent("retry", "entry", 0), "Recovered content");
    assert.equal(getCachedThinkingPreview("retry", "entry", 0), "Recovered content");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = previousFetch; }
});
