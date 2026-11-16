import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { GeneratedImageStore } = await jiti.import("./generated-images.ts");
const { localAutomationContext } = await jiti.import("./automation-local-context.ts");
const metadata = await jiti.import("../app/api/generated-images/route.ts");
const content = await jiti.import("../app/api/generated-images/[id]/content/route.ts");

test("image routes serve only the local workspace, validate IDs and use private raster headers", async () => {
  const base = mkdtempSync(join(tmpdir(), "eureka-image-api-")), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = base;
  try {
    const identity = localAutomationContext(base), store = new GeneratedImageStore(base, identity.ownerKey, identity.assertIdentity);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCXsAAAAASUVORK5CYII=", "base64");
    const item = { id: randomUUID(), provider: "fixture", modelId: "image", prompt: "cat", createdAt: 1, status: "completed", mimeType: "image/png", bytes: bytes.length };
    store.save(item); store.writeImage(item, bytes);
    const request = path => new Request(`http://localhost${path}`, { headers: { host: "localhost" } });
    const listed = await metadata.GET(request(`/api/generated-images?id=${item.id}`));
    assert.equal(listed.status, 200); assert.equal((await listed.json()).item.id, item.id);
    const image = await content.GET(request(`/api/generated-images/${item.id}/content`), { params: Promise.resolve({ id: item.id }) });
    assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("cache-control"), "no-store"); assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.ok(Buffer.from(await image.arrayBuffer()).equals(bytes));
    assert.equal((await content.GET(request("/api/generated-images/bad/content"), { params: Promise.resolve({ id: "../auth.json" }) })).status, 400);
    const other = new GeneratedImageStore(base, "b".repeat(64)); other.save({ ...item, id: randomUUID() });
    const otherId = other.list()[0].id;
    assert.equal((await metadata.GET(request(`/api/generated-images?id=${otherId}`))).status, 404);
    assert.equal((await metadata.GET(new Request("http://localhost/api/generated-images", { headers: { host: "foreign.example" } }))).status, 403);
    assert.equal(metadata.POST, undefined, "chat generation is not exposed as an unrestricted POST endpoint");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(base, { recursive: true, force: true });
  }
});
