import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("market and plugin icons share the authenticated proxy; a different plugin source cannot fetch icons", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "eureka-plugin-icon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "lib/auth"), { recursive: true });
  await writeFile(join(root, "route.ts"), await readFile(new URL("./route.ts", import.meta.url)));
  await writeFile(join(root, "lib/auth/config.ts"), 'exports.getAuthConfig=()=>({issuer:"https://haze.example"});');
  await writeFile(join(root, "lib/auth/session.ts"), "exports.writeAuthSession=async()=>{};");
  await writeFile(join(root, "lib/organization-extensions.ts"), `
    exports.OrganizationExtensionsError=class extends Error {constructor(kind){super(kind);this.kind=kind;}};
    exports.getHazeMarketplaceSession=async()=>{const s=globalThis.__pluginIconRouteTest;if(!s.signedIn)throw new exports.OrganizationExtensionsError('unauthenticated');return {accessToken:'test-only',session:{}};};
    exports.fetchOrganizationExtensionIcon=async(id)=>{globalThis.__pluginIconRouteTest.ids.push(id);return new Response('test-icon',{headers:{'Content-Type':'image/png'}});};
  `);
  globalThis.__pluginIconRouteTest = { signedIn: true, ids: [] };
  t.after(() => { delete globalThis.__pluginIconRouteTest; });
  const jiti = createJiti(import.meta.url, { alias: { "@": root, "next/server": resolve("node_modules/next/server.js") } });
  const { GET } = await jiti.import(join(root, "route.ts"));
  const get = (query = "") => GET(new Request(`http://localhost/api/organization-extensions/42/icon${query}`), { params: Promise.resolve({ id: "42" }) });
  for (const query of ["", "?source=https%3A%2F%2Fhaze.example"]) {
    const response = await get(query);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(await response.text(), "test-icon");
  }
  assert.equal((await get("?source=https%3A%2F%2Fother.example")).status, 404);
  assert.deepEqual(globalThis.__pluginIconRouteTest.ids, ["42", "42"]);
  globalThis.__pluginIconRouteTest.signedIn = false;
  assert.equal((await get("?source=https%3A%2F%2Fhaze.example")).status, 401);
  assert.deepEqual(globalThis.__pluginIconRouteTest.ids, ["42", "42"]);
});
