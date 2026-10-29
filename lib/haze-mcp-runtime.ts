import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { effectivePlugins, pluginStorageRoot, withHazeRegistryLock } from "./haze-registry";
import { cleanupPluginDirectories, clearPluginSnapshot, pluginMcpName, setPluginSnapshot, validatedPluginRoot, installedPluginComposer, type PluginSnapshot } from "./haze-plugin-resources";
import { installPluginSelectionRuntime } from "./plugin-selection-runtime";
import { getProjectTrustStatus } from "./project-trust";

type McpAdapter = { registerMcpServer: (options: { pi: unknown; name: string; definition: Record<string, unknown> }) => unknown };

let adapterModule: Promise<McpAdapter> | null = null;

type ManagedMcp = { capabilityId: string; name: string; serverUrl?: string; type: "MCP" | "Skill"; disabled?: boolean; lifecycle?: "lazy" | "eager" | "keep-alive"; idleTimeout?: number };

function adapter() {
  adapterModule ??= createJiti(import.meta.url, { interopDefault: true }).import("pi-mcp-adapter") as Promise<McpAdapter>;
  return adapterModule;
}

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
  const effective = new Map(global.filter((item) => item.type === "MCP").map((item) => [item.capabilityId, item]));
  for (const item of project) if (item.type === "MCP") effective.set(item.capabilityId, item);
  return [...effective.values()];
}

/** Registers Haze MCPs for one AgentSession without ever persisting their key. */
export async function installHazeManagedMcpRuntime(pi: ExtensionAPI) {
  installPluginSelectionRuntime(pi);
  let registrations: Array<{ dispose: () => unknown }> = [];
  let activeSessionId: string | undefined;
  let activeCwd: string | undefined;
  const release = () => { for (const registration of registrations) { try { registration.dispose(); } catch { /* Adapter shutdown may already have released it. */ } } registrations = []; if (activeSessionId) clearPluginSnapshot(activeSessionId); };
  const cleanup = async (cwd: string) => { for (const scope of ["global", "project"] as const) if (existsSync(pluginStorageRoot(cwd, scope))) await withHazeRegistryLock(cwd, scope, () => cleanupPluginDirectories(cwd, scope)).catch(() => { /* Windows may still have a resource open; retry next time. */ }); };
  pi.on("session_shutdown", async () => { release(); if (activeCwd) await cleanup(activeCwd); });
  pi.on("session_start", async (_event, context) => {
    release();
    activeSessionId = context.sessionManager.getSessionId();
    activeCwd = context.cwd;
    const installs = (await listEffectiveManagedMcps(context.cwd)).filter((install) => !install.disabled && install.serverUrl);
    const { registerMcpServer } = await adapter();
    const headerHook = resolve(process.cwd(), "lib", "haze-mcp-request-headers.mjs");
    for (const install of installs) {
      try {
        const registration = registerMcpServer({
          pi,
          name: install.name,
          definition: {
            url: install.serverUrl,
            auth: false,
            // The adapter runs this hook for each outbound HTTP request. It
            // refreshes Haze OAuth and resolves the current personal MCP key
            // inside the local process, so credential reset is picked up on
            // the next connection without storing a token in env or config.
            requestHeadersCommand: { command: process.execPath, args: [headerHook], timeoutMs: 30_000 },
            lifecycle: install.lifecycle ?? "lazy",
            idleTimeout: install.idleTimeout ?? 10,
          },
        });
        if (registration && typeof (registration as { dispose?: unknown }).dispose === "function") registrations.push(registration as { dispose: () => unknown });
      } catch (error) {
        console.warn(`[haze-mcp] Could not register ${install.name}:`, error instanceof Error ? error.message : String(error));
      }
    }
    const snapshots: PluginSnapshot[] = [];
    const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "");
    for (const install of source ? effectivePlugins(context.cwd, source) : []) {
      if (install.disabled || !install.plugin) continue;
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
          const guard = Buffer.from(JSON.stringify({ source: plugin.source, subject: plugin.subject, url: server.url })).toString("base64url");
          const registration = registerMcpServer({ pi, name, definition: { url: server.url, httpTransport: "streamable-http", auth: false, ...(server.auth ? { requestHeadersCommand: { command: process.execPath, args: [headerHook, "--plugin-guard", guard], timeoutMs: 30_000 } } : {}), lifecycle: install.lifecycle ?? "lazy", idleTimeout: install.idleTimeout ?? 10 } });
          if (registration && typeof (registration as { dispose?: unknown }).dispose === "function") registrations.push(registration as { dispose: () => unknown });
          snapshot.servers.push(name);
        }
      } catch (error) { snapshot.error = error instanceof Error && !(error as NodeJS.ErrnoException).code ? error.message : "插件文件无法读取，请重新安装"; }
    }
    if (activeSessionId) setPluginSnapshot(activeSessionId, context.cwd, snapshots);
    await cleanup(context.cwd);
  });
}
