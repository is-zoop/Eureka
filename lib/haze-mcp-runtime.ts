import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
  pi.on("session_start", async (_event, context) => {
    const installs = (await listEffectiveManagedMcps(context.cwd)).filter((install) => !install.disabled && install.serverUrl);
    if (!installs.length) return;
    const { registerMcpServer } = await adapter();
    const headerHook = resolve(process.cwd(), "lib", "haze-mcp-request-headers.mjs");
    for (const install of installs) {
      try {
        registerMcpServer({
          pi,
          name: install.name,
          definition: {
            url: install.serverUrl,
            auth: false,
            // The adapter runs this hook for each outbound HTTP request. It
            // refreshes Haze OAuth and resolves the current personal MCP key
            // inside the local process, so credential reset is picked up on
            // the next connection without storing a token in env or config.
            requestHeadersCommand: { command: process.execPath, args: [headerHook], timeoutMs: 10_000 },
            lifecycle: install.lifecycle ?? "lazy",
            idleTimeout: install.idleTimeout ?? 10,
          },
        });
      } catch (error) {
        console.warn(`[haze-mcp] Could not register ${install.name}:`, error instanceof Error ? error.message : String(error));
      }
    }
  });
}
