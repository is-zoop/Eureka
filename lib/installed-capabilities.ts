import type { McpServersResponse, PluginPackageInfo, SkillInfo } from "./api-types";

export type CapabilityKind = "Skill" | "Plugin" | "MCP";
export type CapabilityScope = "project" | "global" | "path";
export type ManagedCapabilityInstall = {
  capabilityId: string; name: string; type: CapabilityKind; scope: "project" | "global";
  version: string; installedAt: string; disabled: boolean;
};
export type InstalledCapability = {
  key: string; name: string; kind: CapabilityKind; scope: CapabilityScope;
  origin: "organization" | "market" | "local"; disabled: boolean;
  target:
    | { type: "organization"; install: ManagedCapabilityInstall }
    | { type: "skill"; filePath: string }
    | { type: "plugin"; source: string; scope: "project" | "global" }
    | { type: "mcp"; name: string; scope: "project" | "global" };
};

function pathKey(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

function skillScope(skill: SkillInfo): CapabilityScope {
  if (skill.install) return skill.install.scope;
  const scope = skill.sourceInfo?.scope ?? skill.sourceInfo?.source;
  return scope === "project" ? "project" : scope === "user" || scope === "global" ? "global" : "path";
}

export function mergeInstalledCapabilities({ skills = [], packages = [], mcp = [], managed = [] }: {
  skills?: SkillInfo[]; packages?: PluginPackageInfo[]; mcp?: McpServersResponse[]; managed?: ManagedCapabilityInstall[];
}): InstalledCapability[] {
  const result = new Map<string, InstalledCapability>();
  const addManaged = (install: ManagedCapabilityInstall) => {
    const key = `organization:${install.type}:${install.scope}:${install.capabilityId}`;
    if (!result.has(key)) result.set(key, { key, name: install.name, kind: install.type, scope: install.scope, origin: "organization", disabled: install.disabled, target: { type: "organization", install } });
  };
  managed.forEach(addManaged);
  for (const skill of skills) {
    if (skill.managedPlugin) {
      addManaged({ ...skill.managedPlugin, type: "Plugin", version: "", installedAt: "", disabled: false });
      continue;
    }
    const scope = skillScope(skill);
    if (skill.organizationCapability) {
      const match = managed.find(item => item.type === "Skill" && item.capabilityId === skill.organizationCapability!.capabilityId && (scope === "path" || item.scope === scope));
      addManaged(match ?? { capabilityId: skill.organizationCapability.capabilityId, name: skill.name, type: "Skill", scope: scope === "project" ? "project" : "global", version: "", installedAt: "", disabled: skill.disableModelInvocation });
      continue;
    }
    const key = `skill:${pathKey(skill.filePath)}`;
    result.set(key, { key, name: skill.name, kind: "Skill", scope, origin: skill.install || skill.sourceInfo?.source === "package" ? "market" : "local", disabled: skill.disableModelInvocation, target: { type: "skill", filePath: skill.filePath } });
  }
  for (const pkg of packages) {
    if (pkg.status === "missing" || (pkg.status === "disabled" && !pkg.installedPath && !Object.values(pkg.counts).some(Boolean))) continue;
    const key = `plugin:${pkg.scope}:${pkg.source}`;
    result.set(key, { key, name: pkg.packageName || pkg.source, kind: "Plugin", scope: pkg.scope, origin: /^(npm:|git:|https?:|github:)/i.test(pkg.source) ? "market" : "local", disabled: pkg.disabled, target: { type: "plugin", source: pkg.source, scope: pkg.scope } });
  }
  for (const config of mcp) {
    for (const server of config.servers ?? []) {
      const key = `mcp:${config.scope}:${server.name}`;
      result.set(key, { key, name: server.name, kind: "MCP", scope: config.scope, origin: "local", disabled: Boolean(server.disabled), target: { type: "mcp", name: server.name, scope: config.scope } });
    }
    for (const server of config.managedServers ?? []) addManaged({ capabilityId: server.capabilityId, name: server.name, type: "MCP", scope: server.scope, version: server.version, installedAt: "", disabled: server.disabled });
    for (const server of config.pluginServers ?? []) addManaged({ capabilityId: server.capabilityId, name: server.pluginName, type: "Plugin", scope: config.scope, version: "", installedAt: "", disabled: server.disabled });
  }
  const order = { Skill: 0, Plugin: 1, MCP: 2 };
  return [...result.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}
