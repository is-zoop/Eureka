import type { McpRuntimeStatus, McpServerRuntimeState } from "./api-types";

type Snapshot = {
  servers?: ReadonlyArray<{ name?: string; status?: string; toolCount?: number; disabled?: boolean }>;
  totalTools?: number;
};

declare global { var __eurekaMcpRuntime: Map<string, McpRuntimeStatus> | undefined; }
const runtime = globalThis.__eurekaMcpRuntime ??= new Map<string, McpRuntimeStatus>();

function state(value: string | undefined): McpServerRuntimeState {
  return value === "connected" || value === "cached" || value === "failed" || value === "needs-auth" || value === "not-connected" || value === "disabled" ? value : "unknown";
}

export function updateMcpRuntime(sessionId: string, snapshot: Snapshot) {
  runtime.set(sessionId, {
    sessionId,
    updatedAt: new Date().toISOString(),
    totalTools: snapshot.totalTools ?? 0,
    servers: (snapshot.servers ?? []).map((server) => ({ name: server.name ?? "unknown", state: state(server.status), toolCount: server.toolCount ?? 0, disabled: Boolean(server.disabled) })),
  });
}

export function getMcpRuntime(sessionId: string) { return runtime.get(sessionId) ?? null; }
export function clearMcpRuntime(sessionId: string) { runtime.delete(sessionId); }
