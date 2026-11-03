import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)), "next/server": import.meta.resolve("next/server.js") },
});
const { GET } = await jiti.import("./route.ts");
const { APP_VERSION, APP_LATEST_RELEASE_API } = await jiti.import("../../../lib/app-update.ts");

test("checks Eureka GitHub releases, handles an unpublished repository and upstream failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete globalThis.__eurekaAppUpdateCache; });
  let status = 200;
  let body = { tag_name: "v99.0.0", draft: false, prerelease: false };
  let requests = 0;
  globalThis.fetch = async (url) => {
    assert.equal(url, APP_LATEST_RELEASE_API);
    requests++;
    return Response.json(body, { status });
  };
  delete globalThis.__eurekaAppUpdateCache;
  assert.deepEqual(await (await GET()).json(), {
    currentVersion: APP_VERSION, latestVersion: "99.0.0", updateAvailable: true,
    releaseUrl: "https://github.com/is-zoop/Eureka/releases/tag/v99.0.0",
  });
  await GET(); assert.equal(requests, 1, "successful checks are cached");
  for (const invalid of [{ tag_name: "invalid" }, { tag_name: "v99.0.0", prerelease: true }, { tag_name: "v99.0.0", draft: true }]) {
    delete globalThis.__eurekaAppUpdateCache;
    body = invalid;
    assert.equal((await GET()).status, 502);
  }
  delete globalThis.__eurekaAppUpdateCache;
  status = 404;
  assert.deepEqual(await (await GET()).json(), {
    currentVersion: APP_VERSION, latestVersion: APP_VERSION, updateAvailable: false,
    releaseUrl: "https://github.com/is-zoop/Eureka/releases",
  });
  delete globalThis.__eurekaAppUpdateCache;
  status = 403;
  const error = await GET();
  assert.equal(error.status, 502);
  assert.match((await error.json()).error, /GitHub Releases returned HTTP 403/);
});
