import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpListenState, McpRuntimeStatus, McpServerRuntimeState } from "./api-types";
import { MCP_STATUS_EVENT } from "./mcp-adapter";

type Snapshot = {
  servers?: ReadonlyArray<{ name?: string; status?: string; toolCount?: number; disabled?: boolean; directToolCount?: number; resourceCount?: number; failedAgoSeconds?: number; listenState?: string; catalogStale?: boolean }>;
  totalTools?: number;
  totalResources?: number;
};

declare global { var __eurekaMcpRuntime: Map<string, McpRuntimeStatus> | undefined; }
const runtime = globalThis.__eurekaMcpRuntime ??= new Map<string, McpRuntimeStatus>();

function state(value: string | undefined): McpServerRuntimeState {
  return value === "connected" || value === "cached" || value === "failed" || value === "needs-auth" || value === "not-connected" || value === "disabled" ? value : "unknown";
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function listenState(value: string | undefined): McpListenState | undefined {
  return value === "active" || value === "dropped" || value === "re-establishing" || value === "legacy" || value === "not-listening" || value === "disconnected" ? value : undefined;
}

export function updateMcpRuntime(sessionId: string, snapshot: Snapshot) {
  const servers = (snapshot.servers ?? []).map((server) => ({
    name: server.name ?? "unknown", state: state(server.status), toolCount: count(server.toolCount) ?? 0, disabled: Boolean(server.disabled),
    directToolCount: count(server.directToolCount), resourceCount: count(server.resourceCount),
    failedAgoSeconds: count(server.failedAgoSeconds), listenState: listenState(server.listenState),
    catalogStale: server.catalogStale === true,
  }));
  runtime.set(sessionId, {
    sessionId,
    updatedAt: new Date().toISOString(),
    totalTools: count(snapshot.totalTools) ?? servers.reduce((sum, server) => sum + server.toolCount, 0),
    totalResources: count(snapshot.totalResources),
    connectedCount: servers.filter((server) => server.state === "connected" && !server.disabled).length,
    disabledCount: servers.filter((server) => server.disabled || server.state === "disabled").length,
    servers,
  });
}

export function getMcpRuntime(sessionId: string) { return runtime.get(sessionId) ?? null; }
export function clearMcpRuntime(sessionId: string) { runtime.delete(sessionId); }

/** Subscribe before session_start so the adapter's initial snapshot is not lost. */
export function installMcpStatusRuntime(pi: Pick<ExtensionAPI, "events" | "on">) {
  let sessionId: string | undefined;
  let pending: Snapshot | undefined;
  const unsubscribe = pi.events.on(MCP_STATUS_EVENT, (value: unknown) => {
    if (!value || typeof value !== "object" || !Array.isArray((value as Snapshot).servers)) return;
    const snapshot = value as Snapshot;
    if (sessionId) updateMcpRuntime(sessionId, snapshot);
    else pending = snapshot;
  });
  pi.on("session_start", (_event, context) => {
    const nextId = context.sessionManager.getSessionId();
    if (sessionId && sessionId !== nextId) clearMcpRuntime(sessionId);
    sessionId = nextId;
    if (pending) { updateMcpRuntime(sessionId, pending); pending = undefined; }
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
    if (sessionId) clearMcpRuntime(sessionId);
    sessionId = undefined;
    pending = undefined;
  });
}
