import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import type { PluginManifest } from "./haze-plugin-package";

export type HazeInstallScope = "global" | "project";
export type HazeCapabilityType = "Skill" | "MCP" | "Plugin";
export type HazeMcpLifecycle = "lazy" | "eager" | "keep-alive";
export type HazeMcpRuntimeOptions = { lifecycle: HazeMcpLifecycle; idleTimeout: number };
export type ManagedPlugin = { source: string; subject: string; digest: string; root: string; manifest: PluginManifest; approvedUrls: string[] };
export type HazeManagedInstall = {
  capabilityId: string; name: string; type: HazeCapabilityType; version: string; scope: HazeInstallScope;
  installedAt: string; disabled?: boolean; skillPath?: string; serverUrl?: string;
  lifecycle?: HazeMcpLifecycle; idleTimeout?: number; plugin?: ManagedPlugin;
};
export type HazeRegistry = { version: 1; installs: HazeManagedInstall[] };

export function registryPath(cwd: string, scope: HazeInstallScope) {
  return scope === "global" ? join(getAgentDir(), "eureka-haze-capabilities.json") : join(cwd, ".pi", "eureka-haze-capabilities.json");
}
export function readHazeRegistry(cwd: string, scope: HazeInstallScope): HazeRegistry {
  let raw: string;
  try { raw = readFileSync(registryPath(cwd, scope), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, installs: [] }; throw error; }
  const value = JSON.parse(raw) as HazeRegistry;
  if (value.version !== 1 || !Array.isArray(value.installs)) throw new Error("组织扩展登记文件损坏");
  const installs = value.installs.filter((item) => item && typeof item.capabilityId === "string" && typeof item.version === "string" && typeof item.name === "string" && ["Skill", "MCP", "Plugin"].includes(item.type) && ["global", "project"].includes(item.scope));
  return { version: 1, installs };
}
export async function writeHazeRegistry(cwd: string, scope: HazeInstallScope, registry: HazeRegistry) {
  const path = registryPath(cwd, scope);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
export async function withHazeRegistryLock<T>(cwd: string, scope: HazeInstallScope, work: () => Promise<T>): Promise<T> {
  const path = registryPath(cwd, scope);
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, { realpath: false, retries: { retries: 40, minTimeout: 25, maxTimeout: 100 } });
  try { return await work(); } finally { await release(); }
}
export function effectivePlugins(cwd: string, source?: string): HazeManagedInstall[] {
  const map = new Map<string, HazeManagedInstall>();
  for (const scope of ["global", "project"] as const) for (const item of readHazeRegistry(cwd, scope).installs) {
    if (item.type !== "Plugin" || !item.plugin || (source && item.plugin.source !== source)) continue;
    map.set(`${item.plugin.source}\0${item.capabilityId}`, item);
  }
  return [...map.values()].sort((a, b) => `${a.plugin!.source}/${a.capabilityId}`.localeCompare(`${b.plugin!.source}/${b.capabilityId}`));
}
export function pluginStorageRoot(cwd: string, scope: HazeInstallScope) { return resolve(scope === "global" ? getAgentDir() : join(cwd, ".pi"), "plugins"); }
