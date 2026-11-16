import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBrowserAssets } from "./browser-assets.mjs";
import { configureDevWebpackMemory } from "./dev-webpack-memory.mjs";

test("browser assets preserve the complete upstream bundle, use content versions and avoid rewriting existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "eureka-assets-")), source = join(root, "node_modules/mermaid/dist");
  await mkdir(source, { recursive: true });
  try {
    const bytes = "/* License retained */ globalThis.mermaid={render(){}};";
    await writeFile(join(source, "mermaid.min.js"), bytes);
    const first = prepareBrowserAssets(root), file = join(root, "public", first.mermaidUrl);
    assert.equal(await readFile(file, "utf8"), bytes);
    const info = await stat(file); assert.deepEqual(prepareBrowserAssets(root), first);
    assert.equal((await stat(file)).mtimeMs, info.mtimeMs);
    await writeFile(join(source, "mermaid.min.js"), bytes + "// updated");
    const changed = prepareBrowserAssets(root); assert.notEqual(changed.mermaidUrl, first.mermaidUrl);
    assert.equal(await readFile(file, "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("development evicts old compiler generations without disabling disk cache or changing production", () => {
  class MemoryWithGcCachePlugin { maxGenerations = 5; }
  const plugin = new MemoryWithGcCachePlugin(), cache = { type: "filesystem" }, config = { plugins: [plugin], cache };
  assert.equal(configureDevWebpackMemory(config, false), config); assert.equal(plugin.maxGenerations, 5);
  configureDevWebpackMemory(config, true); assert.equal(plugin.maxGenerations, 1);
  assert.equal(cache.type, "filesystem"); assert.equal(cache.allowCollectingMemory, true);
  const dev = { plugins: [] }; configureDevWebpackMemory(dev, true, "/workspace");
  assert.match(dev.resolve.alias["@/lib/app-fonts$"], /dev-app-fonts\.ts$/);
  assert.ok(Object.entries(dev.resolve.alias).some(([key, value]) => key.endsWith("hotModuleReplacement.js") && value.endsWith("dev-css-hot-reload.js")));
  const production = { plugins: [] }; configureDevWebpackMemory(production, false, "/workspace"); assert.equal(production.resolve, undefined);
});
