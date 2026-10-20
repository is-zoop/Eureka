import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { updateMcpRuntime, getMcpRuntime, clearMcpRuntime, installMcpStatusRuntime } = await jiti.import("./mcp-runtime.ts");
const { MCP_STATUS_EVENT } = await jiti.import("./mcp-adapter.ts");
const { GET } = await jiti.import("../app/api/mcp/status/route.ts");

test("runtime snapshots preserve safe connection/catalog details without connection secrets", async () => {
  const sessionId = "mcp-status-fields";
  try {
    updateMcpRuntime(sessionId, { totalTools: 8, totalResources: 2, servers: [
      { name: "atlas", status: "connected", toolCount: 8, directToolCount: 3, resourceCount: 2, listenState: "active", catalogStale: true, headers: { Authorization: "secret" }, url: "https://secret.example" },
      { name: "offline", status: "failed", toolCount: 0, failedAgoSeconds: 12.8, listenState: "disconnected" },
      { name: "disabled", status: "disabled", disabled: true, toolCount: 0 },
    ] });
    const response = await GET(new Request(`http://localhost/api/mcp/status?sessionId=${sessionId}`));
    assert.equal(response.status, 200);
    const { status } = await response.json();
    assert.equal(status.sessionId, sessionId);
    assert.equal(status.totalResources, 2);
    assert.equal(status.connectedCount, 1);
    assert.equal(status.disabledCount, 1);
    assert.equal(status.servers[0].directToolCount, 3);
    assert.equal(status.servers[0].resourceCount, 2);
    assert.equal(status.servers[0].listenState, "active");
    assert.equal(status.servers[0].catalogStale, true);
    assert.equal(status.servers[1].failedAgoSeconds, 12);
    assert.doesNotMatch(JSON.stringify(status), /secret|Authorization|headers|https:/);
    assert.equal(getMcpRuntime("another-session"), null);
  } finally { clearMcpRuntime(sessionId); }
});

test("old snapshots retain unknown fields as unavailable instead of inventing counts or states", () => {
  const sessionId = "mcp-status-old";
  try {
    updateMcpRuntime(sessionId, { servers: [{ name: "lazy", status: "cached", toolCount: 4 }, { name: "future", status: "future-state", toolCount: -1, directToolCount: NaN, resourceCount: Infinity, listenState: "future-state" }] });
    const status = getMcpRuntime(sessionId);
    assert.equal(status.totalTools, 4);
    assert.equal(status.totalResources, undefined);
    assert.equal(status.servers[0].resourceCount, undefined);
    assert.equal(status.servers[1].state, "unknown");
    assert.equal(status.servers[1].toolCount, 0);
    assert.equal(status.servers[1].directToolCount, undefined);
    assert.equal(status.servers[1].listenState, undefined);
  } finally { clearMcpRuntime(sessionId); }
});

test("status listener captures startup snapshots and releases them across shutdown/reload", () => {
  const subscribers = new Map();
  const lifecycle = new Map();
  const pi = {
    events: { on(name, listener) { subscribers.set(name, listener); return () => subscribers.delete(name); } },
    on(name, handler) { lifecycle.set(name, handler); },
  };
  const emit = (snapshot) => subscribers.get(MCP_STATUS_EVENT)?.(snapshot);
  const start = (id) => lifecycle.get("session_start")({}, { sessionManager: { getSessionId: () => id } });
  const snapshot = { servers: [{ name: "lazy", status: "cached", toolCount: 2 }] };
  try {
    installMcpStatusRuntime(pi);
    emit(snapshot); // The adapter can emit before this extension's session_start.
    start("mcp-startup");
    assert.equal(getMcpRuntime("mcp-startup").servers[0].state, "cached");
    start("mcp-next");
    assert.equal(getMcpRuntime("mcp-startup"), null);
    emit({ ...snapshot, servers: [{ name: "lazy", status: "connected", toolCount: 2 }] });
    assert.equal(getMcpRuntime("mcp-next").connectedCount, 1);
    lifecycle.get("session_shutdown")();
    assert.equal(getMcpRuntime("mcp-next"), null);
    assert.equal(subscribers.size, 0);
    emit(snapshot);
    assert.equal(getMcpRuntime("mcp-next"), null);
    installMcpStatusRuntime(pi);
    emit(snapshot);
    start("mcp-reload");
    assert.equal(getMcpRuntime("mcp-reload").totalTools, 2);
    lifecycle.get("session_shutdown")();
  } finally {
    for (const id of ["mcp-startup", "mcp-next", "mcp-reload"]) clearMcpRuntime(id);
  }
});
