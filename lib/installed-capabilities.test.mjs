import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mergeInstalledCapabilities } = await jiti.import("./installed-capabilities.ts");
const install = (type, scope = "project", extra = {}) => ({ capabilityId: type === "Skill" ? "1" : type === "Plugin" ? "2" : "3", type, scope, name: `Organization ${type}`, version: "1", installedAt: "2026-10-25", disabled: false, ...extra });
const skill = (extra = {}) => ({ name: "local-skill", description: "", filePath: "E:/Project/.pi/skills/local/SKILL.md", baseDir: "E:/Project/.pi/skills/local", disableModelInvocation: false, sourceInfo: { source: "project", scope: "project" }, ...extra });
const pkg = (extra = {}) => ({ source: "npm:example", packageName: "example", scope: "global", status: "installed", disabled: false, filtered: false, counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 }, resources: [], ...extra });

test("combines organization, marketplace, local and disabled capabilities with their actual scopes", () => {
  const items = mergeInstalledCapabilities({
    managed: [install("Skill"), install("Plugin", "global", { disabled: true })],
    skills: [skill(), skill({ name: "market-skill", filePath: "C:/Skills/market/SKILL.md", install: { scope: "global", package: "repo/skill" } })],
    packages: [pkg()],
    mcp: [{ scope: "project", servers: [{ name: "local-server", disabled: true }] }],
  });
  assert.equal(items.length, 6);
  assert.equal(items.find(item => item.name === "market-skill").origin, "market");
  assert.equal(items.find(item => item.name === "market-skill").scope, "global");
  assert.equal(items.find(item => item.name === "local-server").disabled, true);
  assert.equal(items.find(item => item.name === "Organization Plugin").disabled, true);
});

test("deduplicates managed skills and MCP entries while retaining global and project installations", () => {
  const items = mergeInstalledCapabilities({
    managed: [install("Skill"), install("Skill", "global"), install("MCP")],
    skills: [skill({ organizationCapability: { capabilityId: "1" } })],
    mcp: [{ scope: "project", servers: [], managedServers: [{ capabilityId: "3", name: "Organization MCP", scope: "project", version: "1", disabled: false }] }],
  });
  assert.equal(items.length, 3);
  assert.equal(items.filter(item => item.kind === "Skill").length, 2);
  assert.deepEqual(items.filter(item => item.kind === "Skill").map(item => item.scope).sort(), ["global", "project"]);
});

test("plugin-owned skills and servers resolve to their owning plugin instead of duplicating it", () => {
  const items = mergeInstalledCapabilities({
    managed: [install("Plugin", "global", { disabled: true })],
    skills: [skill({ managedPlugin: { capabilityId: "2", name: "Organization Plugin", scope: "global" }, organizationCapability: { capabilityId: "2" } })],
    mcp: [{ scope: "global", servers: [], pluginServers: [{ capabilityId: "2", pluginName: "Organization Plugin", name: "plugin-server", disabled: false }] }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "Plugin");
  assert.equal(items[0].disabled, true, "the managed installation is authoritative over component summaries");
});

test("falls back to managed component summaries when the installation endpoint is unavailable", () => {
  const items = mergeInstalledCapabilities({ skills: [skill({ managedPlugin: { capabilityId: "2", name: "Plugin fallback", scope: "project" } })], mcp: [{ scope: "global", servers: [], managedServers: [{ capabilityId: "3", name: "MCP fallback", version: "1", scope: "global", disabled: true }] }] });
  assert.equal(items.length, 2);
  assert.ok(items.every(item => item.origin === "organization"));
});

test("does not mistake missing configured packages for installed capabilities", () => {
  const items = mergeInstalledCapabilities({ packages: [pkg({ status: "missing" }), pkg({ source: "npm:missing-disabled", status: "disabled", disabled: true, counts: { extensions: 0, skills: 0, prompts: 0, themes: 0 } })] });
  assert.deepEqual(items, []);
});

test("deduplicates Windows paths without conflating case-sensitive POSIX paths or unknown scopes", () => {
  const items = mergeInstalledCapabilities({ skills: [skill(), skill({ filePath: "e:\\project\\.pi\\skills\\local\\SKILL.md" }), skill({ filePath: "/skills/Local/SKILL.md", sourceInfo: { source: "path" } }), skill({ filePath: "/skills/local/SKILL.md", sourceInfo: { source: "path" } })] });
  assert.equal(items.length, 3);
  assert.equal(items.filter(item => item.scope === "path").length, 2);
});
