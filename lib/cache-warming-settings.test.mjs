import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
test("cache settings preserve defaults, persist modes, update live sessions and reject foreign origins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eureka-cache-settings-"));
  const previous = process.env.PI_CODING_AGENT_DIR, sessions = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { GET, PUT } = await jiti.import("../app/api/settings/cache-warming/route.ts");
    const request = (mode, origin = "http://localhost") => new Request("http://localhost/api/settings/cache-warming", { method: "PUT", headers: { host: "localhost", origin, "content-type": "application/json" }, body: JSON.stringify({ mode }) });
    assert.equal((await GET(new Request("http://localhost/api/settings/cache-warming", { headers: { host: "localhost" } }))).status, 200);
    assert.equal((await PUT(request("invalid"))).status, 400);
    assert.equal((await PUT(request("idle", "https://foreign.example"))).status, 403);
    const seen = [];
    globalThis.__piSessions = new Map([["live", { inner: { setCacheWarmingMode: mode => seen.push(mode), settingsManager: { flush: async () => {} } } }]]);
    for (const mode of ["off", "streaming", "idle"]) {
      assert.equal((await PUT(request(mode))).status, 200);
      assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).cacheWarming, mode);
    }
    assert.deepEqual(seen, ["off", "streaming", "idle"]);
  } finally {
    globalThis.__piSessions = sessions;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
