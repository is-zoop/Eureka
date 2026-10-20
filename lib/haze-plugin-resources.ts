import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getAgentDir, loadSkillsFromDir, type Skill, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { effectivePlugins, readHazeRegistry, pluginStorageRoot, type HazeManagedInstall, type HazeInstallScope } from "./haze-registry";
import { isPathWithinRoots } from "./path-security";
import { getMcpRuntime } from "./mcp-runtime";
import { samePath } from "./paths";
import { getProjectTrustStatus } from "./project-trust";

type SkillSet = { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
export type PluginSnapshot = { capabilityId: string; source: string; digest: string; root: string; servers: string[]; capabilities?: { requestUserInput?: boolean }; error?: string };
declare global { var __eurekaPluginSnapshots: Map<string, { cwd: string; plugins: PluginSnapshot[] }> | undefined; }
const snapshots: Map<string, { cwd: string; plugins: PluginSnapshot[] }> = globalThis.__eurekaPluginSnapshots ??= new Map();
export function pluginMcpName(item: HazeManagedInstall, name: string) {
  return `haze_${createHash("sha256").update(item.plugin!.source).digest("hex").slice(0, 8)}_${item.capabilityId}__${name}`;
}
export function validatedPluginRoot(cwd: string, item: HazeManagedInstall): string {
  const plugin = item.plugin;
  if (!plugin || !existsSync(plugin.root)) throw new Error("插件目录不存在");
  const root = realpathSync(plugin.root), storage = realpathSync(pluginStorageRoot(cwd, item.scope));
  const base = realpathSync(item.scope === "global" ? getAgentDir() : cwd);
  if (!isPathWithinRoots(storage, new Set([base]))) throw new Error("插件存储目录越界");
  if (!isPathWithinRoots(root, new Set([storage])) || samePath(root, storage)) throw new Error("插件目录越界");
  return root;
}
export function applyOrganizationPluginSkills(cwd: string, base: SkillSet, source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "")): SkillSet {
  const skills = [...base.skills], diagnostics = [...base.diagnostics];
  const names = new Set(skills.map((skill) => skill.name));
  if (!source) return base;
  for (const item of effectivePlugins(cwd, source)) {
    if (item.disabled) continue;
    if (item.scope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) {
      diagnostics.push({ type: "warning", path: item.plugin!.root, message: "项目资源尚未受信任，组织插件未加载" });
      continue;
    }
    try {
      const root = validatedPluginRoot(cwd, item);
      for (const directory of item.plugin!.manifest.skillDirectories) {
        const dir = realpathSync(resolve(root, directory));
        if (!isPathWithinRoots(dir, new Set([root]))) throw new Error("技能路径越界");
        const loaded = loadSkillsFromDir({ dir, source: item.scope });
        diagnostics.push(...loaded.diagnostics);
        for (const skill of loaded.skills) {
          if (names.has(skill.name)) { diagnostics.push({ type: "warning", path: skill.filePath, message: `组织插件 ${item.name} 的技能 ${skill.name} 与现有技能重名，未覆盖现有技能` }); continue; }
          names.add(skill.name);
          skills.push(Object.assign(skill, { managedPlugin: { capabilityId: item.capabilityId, name: item.name, scope: item.scope } }));
        }
      }
    } catch (error) { diagnostics.push({ type: "warning", path: item.plugin!.root, message: error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : "插件技能文件无法读取，请重新安装" }); }
  }
  return { skills, diagnostics };
}
export function setPluginSnapshot(sessionId: string, cwd: string, plugins: PluginSnapshot[]) { snapshots.set(sessionId, { cwd, plugins }); }
export function clearPluginSnapshot(sessionId: string) { snapshots.delete(sessionId); }
export function pluginRootIsActive(root: string) { return [...snapshots.values()].some((snapshot) => snapshot.plugins.some((plugin) => samePath(plugin.root, root))); }
export function pluginPresentation(item: HazeManagedInstall, sessionId?: string | null, subject?: string | null) {
  const plugin = item.plugin;
  if (!plugin) return undefined;
  const loaded = sessionId ? snapshots.get(sessionId)?.plugins.find((entry) => entry.capabilityId === item.capabilityId && entry.source === plugin.source) : undefined;
  const servers = getMcpRuntime(sessionId ?? "")?.servers.filter((server) => loaded?.servers.includes(server.name)) ?? [];
  let state = "installed";
  if (loaded && (item.disabled || loaded.digest !== plugin.digest)) state = "pending-reload";
  else if (item.disabled) state = "disabled";
  else if (loaded?.error) state = "failed";
  else if (loaded) state = servers.some((server) => server.state === "needs-auth") ? "needs-auth" : servers.some((server) => server.state === "failed") ? "failed" : "loaded";
  else if (sessionId && snapshots.has(sessionId)) state = "pending-reload";
  if (!item.disabled && subject !== undefined && plugin.manifest.servers.some((server) => server.auth) && subject !== plugin.subject) state = "needs-auth";
  return { name: plugin.manifest.name, digest: plugin.digest, skills: plugin.manifest.skillDirectories, servers: plugin.manifest.servers, capabilities: plugin.manifest.capabilities, state, ...(loaded?.error ? { error: loaded.error } : {}) };
}

export async function cleanupPluginDirectories(cwd: string, scope: HazeInstallScope) {
  const root = pluginStorageRoot(cwd, scope);
  if (!existsSync(root)) return;
  const base = realpathSync(scope === "global" ? getAgentDir() : cwd);
  if (!isPathWithinRoots(realpathSync(root), new Set([base]))) return;
  const registered = readHazeRegistry(cwd, scope).installs.flatMap((item) => item.plugin ? [item.plugin.root] : []);
  for (const source of await readdir(root)) {
    if (!/^[a-f0-9]{16}$/.test(source)) continue;
    const sourceDir = join(root, source);
    if (!isPathWithinRoots(realpathSync(sourceDir), new Set([realpathSync(root)]))) continue;
    for (const id of await readdir(sourceDir)) {
      if (!/^\d+$/.test(id)) continue;
      const capabilityDir = join(sourceDir, id);
      if (!isPathWithinRoots(realpathSync(capabilityDir), new Set([realpathSync(root)]))) continue;
      for (const directory of await readdir(capabilityDir)) {
        if (!/^[a-f0-9]{64}-[a-f0-9]{12}$/.test(directory)) continue;
        const path = join(capabilityDir, directory);
        if (!registered.some((entry) => samePath(entry, path)) && !pluginRootIsActive(path) && isPathWithinRoots(realpathSync(path), new Set([realpathSync(root)]))) await rm(path, { recursive: true, force: true });
      }
    }
  }
}

export function getPluginSnapshots(sessionId: string) { return snapshots.get(sessionId)?.plugins ?? []; }
