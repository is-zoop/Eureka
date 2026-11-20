import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

test("diagram loading coalesces concurrent previews and recovers after a failed asset request", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, url: process.env.NEXT_PUBLIC_MERMAID_ASSET_URL };
  const scripts = [];
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ remove() { this.removed = true; } }), head: { appendChild(script) { scripts.push(script); } } };
  process.env.NEXT_PUBLIC_MERMAID_ASSET_URL = "/vendor/mermaid/mermaid-fixture.min.js";
  try {
    const { loadMermaid } = await createJiti(import.meta.url).import("../../components/content/mermaid-browser.ts");
    const first = loadMermaid();
    assert.equal(loadMermaid(), first);
    assert.equal(scripts.length, 1);
    scripts[0].onerror();
    await assert.rejects(first, /could not be loaded/);
    assert.equal(scripts[0].removed, true);
    const retry = loadMermaid();
    assert.equal(scripts.length, 2);
    const api = { render() {}, parse() {} };
    globalThis.window.mermaid = api;
    scripts[1].onload();
    assert.equal(await retry, api);
    assert.equal(await loadMermaid(), api);
    assert.equal(scripts.length, 2);
  } finally {
    for (const key of ["window", "document"]) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; }
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_MERMAID_ASSET_URL; else process.env.NEXT_PUBLIC_MERMAID_ASSET_URL = previous.url;
  }
});
