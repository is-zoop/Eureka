import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
  alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") },
});
const { GET } = await jiti.import("./route.ts");
const { proxy } = await jiti.import("../../../proxy.ts");
const { NextRequest } = await import("next/server.js");
const url = "http://127.0.0.1:8080/api/desktop-startup";
const launch = "ab".repeat(16);

function request(options = {}, host = "127.0.0.1:8080") {
  return new NextRequest(url, {
    method: options.method,
    headers: { host, ...options.headers },
  });
}

test("native startup probe identifies only the current bundled listener and bypasses session auth", (t) => {
  const previous = process.env.EUREKA_DESKTOP_STARTUP_ID;
  t.after(() => {
    if (previous === undefined) delete process.env.EUREKA_DESKTOP_STARTUP_ID;
    else process.env.EUREKA_DESKTOP_STARTUP_ID = previous;
  });

  delete process.env.EUREKA_DESKTOP_STARTUP_ID;
  assert.equal(GET(request()).status, 404);
  process.env.EUREKA_DESKTOP_STARTUP_ID = launch;
  assert.equal(proxy(request()).headers.get("x-middleware-next"), "1");
  const response = GET(request());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("X-Eureka-Startup-Id"), launch);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(GET(request({}, "127.0.0.1:18080")).status, 204);

  const crossSite = request({ headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(proxy(crossSite).status, 403);
  assert.equal(GET(crossSite).status, 404);
  assert.equal(GET(request({}, "192.168.1.40:8080")).status, 404);
  assert.equal(proxy(request({ method: "POST" })).status, 401);
});
