import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
test("command environment settings reject foreign origins and invalid shells without changing saved settings", async t => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-shell-route-")), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const request = (method, environment, origin = "http://localhost:8080") => new Request("http://localhost:8080/api/settings/command-environment", { method, headers: { host: "localhost:8080", origin, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify({ environment }) }) });
  assert.equal((await route.PUT(request("PUT", "powershell", "https://foreign.invalid"))).status, 403);
  assert.equal((await route.PUT(request("PUT", "cmd"))).status, 400);
  assert.equal((await (await route.GET(request("GET"))).json()).environment, "bash");
  const environment = process.platform === "win32" ? "powershell" : "bash";
  assert.equal((await route.PUT(request("PUT", environment))).status, 200);
  assert.equal((await (await route.GET(request("GET"))).json()).environment, environment);
});
