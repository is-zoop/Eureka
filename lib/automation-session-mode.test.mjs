import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
const { AutomationModeFileCache } = await createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } }).import("./automation-session-mode.ts");

test("polling reuses mode metadata without retaining or reparsing the conversation; rewrites invalidate it", async () => {
  const root = await mkdtemp(join(tmpdir(), "eureka-mode-cache-")), file = join(root, "session.jsonl");
  try {
    await writeFile(file, "old history"); const cache = new AutomationModeFileCache(); let reads = 0;
    const load = () => { reads++; return { status: "active", task: { id: "fixture" } }; };
    const [one, two] = await Promise.all([cache.read(file, load), cache.read(file, load)]); one.status = "paused";
    assert.equal(two.status, "active"); await cache.read(file, load); assert.equal(reads, 1);
    await writeFile(file, "new branch!"); await utimes(file, new Date(), new Date(Date.now() + 1000));
    await cache.read(file, load); assert.equal(reads, 2);
    await rm(file); await assert.rejects(cache.read(file, load), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
