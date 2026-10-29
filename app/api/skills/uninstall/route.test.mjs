import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("skill uninstall validates requests and exact scoped identity before removing a temporary installation", async t => {
  const root = resolve(mkdtempSync(join(tmpdir(), "eureka-skill-uninstall-route-")));
  const agentDir = join(root, "agent"), cwd = join(root, "project"), filePath = join(cwd, ".agents", "skills", "test-skill", "SKILL.md");
  mkdirSync(agentDir, { recursive: true }); mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "---\nname: test-skill\ndescription: Route test\n---\nInstructions\n");
  writeFileSync(join(cwd, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "test-skill": { source: "test/temporary", sourceType: "github" } } }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR, previousCache = globalThis.__piAllowedRootsCache;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAllowedRootsCache = { roots: new Set([cwd]), expiresAt: Date.now() + 120000 };
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAllowedRootsCache = previousCache;
    assert.equal(dirname(root), resolve(tmpdir())); rmSync(root, { recursive: true, force: true });
  });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { POST } = await jiti.import("./route.ts");
  const payload = { cwd, scope: "project", package: "test/temporary@test-skill", filePath };
  const request = (body, headers = {}) => new Request("http://localhost/api/skills/uninstall", { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await POST(request(payload, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await POST(request(payload, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request(null))).status, 400);
  assert.equal((await POST(request({ ...payload, scope: "invalid" }))).status, 400);
  assert.equal((await POST(request({ ...payload, cwd: root }))).status, 403);
  for (const change of [{ package: "wrong/repo@test-skill" }, { scope: "global" }, { filePath: join(root, "SKILL.md") }]) {
    assert.equal((await POST(request({ ...payload, ...change }))).status, 404); assert.ok(existsSync(filePath));
  }
  const response = await POST(request(payload));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true });
  assert.equal(existsSync(filePath), false);
  assert.equal((await POST(request(payload))).status, 404);
});
