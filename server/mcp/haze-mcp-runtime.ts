import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { effectivePlugins, pluginStorageRoot, withHazeRegistryLock } from "../extensions/haze-registry";
import { cleanupPluginDirectories, clearPluginSnapshot, pluginMcpName, setPluginSnapshot, validatedPluginRoot, installedPluginComposer, type PluginSnapshot } from "../extensions/haze-plugin-resources";
import { installPluginSelectionRuntime } from "../extensions/plugin-selection-runtime";
import { getProjectTrustStatus } from "../../lib/project-trust";
import { readRuntimeHazeSession } from "../../lib/auth/runtime-session";
import { assertHazeMcpIdentity, type HazeMcpIdentity } from "./haze-native-mcp-auth";
import { setHazeNativeMcpBindings, clearHazeNativeMcpBindings, type HazeNativeMcpBinding } from "./haze-native-mcp-bindings";

type ManagedMcp = { exposure?: "direct" | "deferred" | "codemode"; capabilityId: string; name: string; serverUrl?: string; type: "MCP" | "Skill"; disabled?: boolean; scope?: "global" | "project"; lifecycle?: "lazy" | "eager" | "keep-alive"; idleTimeout?: number };

async function readInstalls(path: string): Promise<ManagedMcp[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { installs?: unknown };
    return Array.isArray(value.installs) ? value.installs.filter((item): item is ManagedMcp => Boolean(item) && typeof (item as ManagedMcp).capabilityId === "string" && typeof (item as ManagedMcp).name === "string" && ((item as ManagedMcp).type === "MCP" || (item as ManagedMcp).type === "Skill")) : [];
  } catch { return []; }
}

async function listEffectiveManagedMcps(cwd: string) {
  const [global, project] = await Promise.all([
    readInstalls(resolve(getAgentDir(), "eureka-haze-capabilities.json")),
    readInstalls(resolve(cwd, ".pi", "eureka-haze-capabilities.json")),
  ]);
  const effective = new Map<string, ManagedMcp>(global.filter((item) => item.type === "MCP").map((item) => [item.capabilityId, { ...item, scope: "global" as const }]));
  for (const item of project) if (item.type === "MCP") effective.set(item.capabilityId, { ...item, scope: "project" as const });
  return [...effective.values()];
}

/** Registers Haze MCPs for one AgentSession without ever persisting their key. */
export async function installHazeManagedMcpRuntime(pi: ExtensionAPI) {
  installPluginSelectionRuntime(pi);
  let registrations: string[] = [];
  let activeSessionId: string | undefined;
  let activeCwd: string | undefined;
  const release = () => { if (activeSessionId) clearHazeNativeMcpBindings(activeSessionId); for (const name of registrations) pi.unregisterMcpServer(name); registrations = []; if (activeSessionId) clearPluginSnapshot(activeSessionId); };
  const cleanup = async (cwd: string) => { for (const scope of ["global", "project"] as const) if (existsSync(pluginStorageRoot(cwd, scope))) await withHazeRegistryLock(cwd, scope, () => cleanupPluginDirectories(cwd, scope)).catch(() => { /* Windows may still have a resource open; retry next time. */ }); };
  pi.on("session_shutdown", async () => { release(); if (activeCwd) await cleanup(activeCwd); });
  pi.on("session_start", async (_event, context) => {
    release();
    activeSessionId = context.sessionManager.getSessionId();
    activeCwd = context.cwd;
    const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "");
    const login = readRuntimeHazeSession();
    const identity: HazeMcpIdentity | null = source && login?.runtimeId ? { source, subject: login.principal.subject, runtimeId: login.runtimeId, providerId: login.providerId } : null;
    const bindings: HazeNativeMcpBinding[] = [];
    const register = (binding: HazeNativeMcpBinding, exposure: "direct" | "deferred" | "codemode" = "direct") => {
      bindings.push(binding);
      setHazeNativeMcpBindings(activeSessionId!, bindings);
      pi.registerMcpServer(binding.name, { url: binding.url, exposure, timeout: 60 });
      registrations.push(binding.name);
    };
    const installs = (await listEffectiveManagedMcps(context.cwd)).filter((install) => !install.disabled && install.serverUrl);
    for (const install of installs) {
      try {
        if (install.scope === "project" && !getProjectTrustStatus(context.cwd, getAgentDir()).trusted) throw new Error("项目资源尚未受信任，Haze MCP 未加载。");
        const name = /^[A-Za-z0-9_-]+$/.test(install.name) ? install.name : `haze_mcp_${createHash("sha256").update(install.capabilityId).digest("hex").slice(0, 12)}`;
        register({
          name, url: install.serverUrl!, authenticated: true, identity,
          validate: async () => {
            if (!identity) throw new Error("请登录 Haze 并重载会话。");
            assertHazeMcpIdentity(identity);
            const current = (await listEffectiveManagedMcps(context.cwd)).find((item) => item.capabilityId === install.capabilityId);
            if (!current || current.disabled || current.serverUrl !== install.serverUrl || current.name !== install.name) throw new Error("Haze MCP 已变更或停用，请重载会话。");
            if (current.scope === "project" && !getProjectTrustStatus(context.cwd, getAgentDir()).trusted) throw new Error("项目资源尚未受信任。");
          },
        }, install.exposure === "deferred" || install.exposure === "codemode" ? install.exposure : "direct");
      } catch (error) {
        console.warn(`[haze-mcp] Could not register ${install.name}:`, error instanceof Error ? error.message : String(error));
      }
    }
    const snapshots: PluginSnapshot[] = [];
    for (const install of source ? effectivePlugins(context.cwd, source) : []) {
      if (install.disabled || !install.plugin || install.plugin.manifest.automation) continue;
      const plugin = install.plugin;
      const snapshot: PluginSnapshot = { capabilityId: install.capabilityId, source: plugin.source, digest: plugin.digest, root: plugin.root, servers: [], capabilities: plugin.manifest.capabilities };
      snapshots.push(snapshot);
      try {
        if (install.scope === "project" && !getProjectTrustStatus(context.cwd, getAgentDir()).trusted) throw new Error("项目资源尚未受信任，组织插件未加载");
        validatedPluginRoot(context.cwd, install);
        snapshot.composer = installedPluginComposer(context.cwd, install);
        for (const server of plugin.manifest.servers) {
          if (server.auth && !plugin.approvedUrls.includes(server.url)) throw new Error("MCP 服务地址尚未授权");
          const name = pluginMcpName(install, server.name);
          register({ name, url: server.url, authenticated: Boolean(server.auth), identity,
            validate: () => {
              if (!identity || plugin.source !== identity.source || plugin.subject !== identity.subject) throw new Error("插件登录身份已变化，请重新登录并重载会话。");
              assertHazeMcpIdentity(identity);
              const current = effectivePlugins(context.cwd, plugin.source).find((item) => item.capabilityId === install.capabilityId);
              if (!current || current.disabled || current.plugin?.digest !== plugin.digest || current.plugin.subject !== identity.subject || !current.plugin.manifest.servers.some((entry) => entry.name === server.name && entry.url === server.url && entry.auth === server.auth)) throw new Error("插件已变更或停用，请重载会话。");
              if (current.scope === "project" && !getProjectTrustStatus(context.cwd, getAgentDir()).trusted) throw new Error("项目插件尚未受信任。");
              if (server.auth && !current.plugin.approvedUrls.includes(server.url)) throw new Error("MCP 服务地址尚未授权。");
            },
          });
          snapshot.servers.push(name);
        }
      } catch (error) { snapshot.error = error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : "插件文件无法读取，请重新安装"; }
    }
    if (activeSessionId) setPluginSnapshot(activeSessionId, context.cwd, snapshots);
    await cleanup(context.cwd);
  });
}
