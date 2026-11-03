import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishDraft } from "./publish-release.mjs";
const sha = "a".repeat(40);
function fixture(t, release = null) {
  const directory = mkdtempSync(join(tmpdir(), "eureka-publish-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const info = { repo: "is-zoop/Eureka", tag: "v0.8.8", notes: "Reviewed notes", directory, filenames: ["app.exe", "app.exe.sig", "latest.json", "SHA256SUMS.txt"] };
  info.filenames.forEach(name => writeFileSync(join(directory, name), name));
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input); calls.push({ url, method: options.method, body: options.body });
    if (url.hostname === "uploads.github.com") {
      const reader = options.body.getReader(); while (!(await reader.read()).done) { /* Consume the upload. */ }
      release.assets.push({ name: url.searchParams.get("name"), state: "uploaded" });
      return Response.json({});
    }
    const path = url.pathname.replace("/repos/is-zoop/Eureka", "");
    if (path.startsWith("/git/ref/tags/")) return Response.json({ object: { type: "commit", sha } });
    if (path.startsWith("/releases/tags/")) return release ? Response.json(release) : new Response(null, { status: 404 });
    if (path === "/releases" && options.method === "POST") {
      const body = JSON.parse(options.body); assert.equal(body.draft, true); assert.equal(body.target_commitish, sha);
      release = { ...body, id: 1, assets: [], upload_url: "https://uploads.github.com/repos/is-zoop/Eureka/releases/1/assets{?name,label}", html_url: "https://github.com/is-zoop/Eureka/releases/tag/v0.8.8" };
    }
    return Response.json(release);
  };
  return { info, calls, options: { token: "test-token", sha, fetchImpl } };
}
test("publishing uploads all assets and the updater manifest last while retaining draft status", async t => {
  const f = fixture(t), result = await publishDraft(f.info, f.options);
  assert.equal(result.draft, true);
  const uploads = f.calls.filter(call => call.url.hostname === "uploads.github.com");
  assert.deepEqual(uploads.map(call => call.url.searchParams.get("name")), ["app.exe", "app.exe.sig", "SHA256SUMS.txt", "latest.json"]);
  assert.equal(f.calls.some(call => call.method === "PATCH" && JSON.parse(call.body).draft === false), false);
});
test("an existing public release cannot be overwritten", async t => {
  const f = fixture(t, { draft: false, target_commitish: sha });
  await assert.rejects(() => publishDraft(f.info, f.options), /Refusing to overwrite/);
  assert.equal(f.calls.some(call => call.method !== "GET"), false);
});
