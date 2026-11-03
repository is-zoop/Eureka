import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { sameNativeBrowser } = await jiti.import("./native-browser.ts");
const draft = { websiteUrl: "https://example.com/items", taskDescription: "查询编号" };
test("browser reuse never crosses account or owner boundaries", () => {
  const spec = { sessionId: "automation:one", ownerKey: "a".repeat(64), websiteUrl: draft.websiteUrl, accountId: "a".repeat(32) };
  assert.equal(sameNativeBrowser(spec, { ...spec }), true);
  assert.equal(sameNativeBrowser(spec, { ...spec, accountId: "b".repeat(32) }), false);
  assert.equal(sameNativeBrowser(spec, { ...spec, accountId: undefined }), false);
  assert.equal(sameNativeBrowser(spec, { ...spec, ownerKey: "b".repeat(64) }), false);
  const normal = { ...spec, accountId: undefined };
  assert.equal(sameNativeBrowser(normal, { ...normal, browserMode: "temporary" }), false);
});
