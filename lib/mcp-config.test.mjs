import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const { mutateMcpServers, listMcpServers, validateMcpServer } = await createJiti(import.meta.url).import("./mcp-config.ts");

test("MCP configuration changes preserve discovery overrides and advanced SDK options", async t => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-mcp-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const path = join(dir, "mcp.json");
  const original = { url: "https://example.com/mcp", exposure: "deferred", oauth: { clientRegistration: "dcr" }, toolExposure: { write: "hidden" }, description: "中文搜索", timeout: 60 };
  await writeFile(path, JSON.stringify({ custom: 1, mcpServers: { old: original } }));
  await mutateMcpServers(dir, "global", "update", { name: "renamed", transport: "http", url: original.url, exposure: "codemode" }, "old");
  let config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.custom, 1);
  assert.equal(config.mcpServers.old, undefined);
  assert.deepEqual(config.mcpServers.renamed.oauth, original.oauth);
  assert.deepEqual(config.mcpServers.renamed.toolExposure, original.toolExposure);
  assert.equal(config.mcpServers.renamed.exposure, "codemode");
  await mutateMcpServers(dir, "global", "update", { name: "renamed", transport: "stdio", command: "node" }, "renamed");
  config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.mcpServers.renamed.url, undefined);
  assert.equal(config.mcpServers.renamed.oauth, undefined);
  assert.equal(config.mcpServers.renamed.exposure, "codemode");
  assert.deepEqual(config.mcpServers.renamed.toolExposure, original.toolExposure);
  await mutateMcpServers(dir, "global", "create", { name: "new", transport: "stdio", command: "node" });
  assert.equal((await listMcpServers(dir, "global")).servers.find(s => s.name === "new").exposure, "direct");
});

test("MCP configuration rejects invalid exposures and accepts individual hidden tools", () => {
  const base = { name: "valid", transport: "stdio", command: "node" };
  assert.throws(() => validateMcpServer({ ...base, exposure: "anything" }));
  assert.throws(() => validateMcpServer({ ...base, toolExposure: { danger: "anything" } }));
  assert.deepEqual(validateMcpServer({ ...base, exposure: "deferred", toolExposure: { danger: "hidden" } }).toolExposure, { danger: "hidden" });
});
