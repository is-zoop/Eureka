import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { parseClientCommand, serializeServerEvent, type ServerEvent, type SessionSnapshot, type WebContextUsage, type WebModel, type WebUsage } from "@pi-web/protocol";
import type { ServerConfig } from "./config.js";
import { PiEventNormalizer } from "./pi/event-normalizer.js";
import { PiRuntimeManager } from "./pi/runtime-manager.js";
import { PiSessionController } from "./pi/session-controller.js";
import { WorkspaceFileError, WorkspaceFiles } from "./workspace-files.js";

const WEBSOCKET_OPEN = 1;
const MAX_WEBSOCKET_PAYLOAD = 30 * 1024 * 1024;
type PiModel = { provider: string; id: string; name?: string; contextWindow?: number; reasoning?: unknown };
export interface GatewayTestDependencies { manager: PiRuntimeManager; controller: PiSessionController; files: WorkspaceFiles; }

export async function createServer(config: ServerConfig, injected?: GatewayTestDependencies) {
  let socket: WebSocket | undefined;
  const normalizer = new PiEventNormalizer();
  const send = (event: ServerEvent) => {
    if (socket?.readyState !== WEBSOCKET_OPEN) return;
    try { socket.send(serializeServerEvent(event)); }
    catch { if (event.type !== "error") socket.send(serializeServerEvent({ type: "error", error: { code: "event_serialization_failed", message: "A server event could not be safely delivered.", recoverable: true } })); }
  };
  const manager = injected?.manager ?? new PiRuntimeManager(config.workspace, (event) => {
    normalizer.normalize(event).forEach(send);
    const type = typeof event === "object" && event ? (event as { type?: unknown }).type : undefined;
    if (type === "message_end" || type === "agent_end" || type === "compaction_end") void sendUsage();
  });
  if (!injected) await manager.initialize();
  const controller = injected?.controller ?? new PiSessionController(manager);
  const files = injected?.files ?? new WorkspaceFiles(config.workspace);

  const usage = (): { usage: WebUsage; context?: WebContextUsage } => {
    const session = manager.getSession();
    const stats = session.getSessionStats();
    const current = session.getContextUsage() ?? stats.contextUsage;
    const context = current ? {
      ...(current.tokens === null ? {} : { usedTokens: current.tokens }),
      ...(current.contextWindow > 0 ? { maxTokens: current.contextWindow } : {}),
      ...(current.percent === null ? {} : { percentage: current.percent }),
    } : undefined;
    return { usage: { inputTokens: stats.tokens.input, outputTokens: stats.tokens.output, cacheReadTokens: stats.tokens.cacheRead, cacheWriteTokens: stats.tokens.cacheWrite, cost: stats.cost }, ...(context ? { context } : {}) };
  };
  const snapshot = async (): Promise<SessionSnapshot> => {
    const session = manager.getSession();
    const available = await manager.getRuntime().services.modelRuntime.getAvailable();
    return {
      sessionId: session.sessionId,
      ...(session.sessionName ? { sessionName: session.sessionName } : {}),
      cwd: config.workspace,
      phase: session.isCompacting ? "compacting" : session.isStreaming ? "running" : "idle",
      ...(session.model ? { model: webModel(session.model) } : {}),
      thinkingLevel: session.thinkingLevel,
      availableModels: available.map(webModel),
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      messages: session.messages.map((message, index) => ({ id: `${session.sessionId}:${index}`, role: message.role === "user" ? "user" : "assistant", content: JSON.parse(JSON.stringify(message.content)), createdAt: Date.now() })),
      ...usage(),
    };
  };
  const sendSnapshot = async () => { try { send({ type: "snapshot", snapshot: await snapshot() }); } catch { send({ type: "error", error: { code: "snapshot_failed", message: "The current session state could not be loaded.", recoverable: true } }); } };
  const sendUsage = async () => send({ type: "usage", ...usage() });
  const sendSessions = async () => { try { send({ type: "sessions", sessions: await controller.listSessions() }); } catch { send({ type: "error", error: { code: "session_list_failed", message: "The session list could not be loaded.", recoverable: true } }); } };
  const sendFiles = async (relative?: string) => { try { send({ type: "file_list", ...(relative ? { path: relative } : {}), entries: await files.list(relative) }); } catch (cause) { sendFileError(cause, send); } };
  const sendPreview = async (relative: string) => { try { send({ type: "file_preview", preview: await files.preview(relative) }); } catch (cause) { sendFileError(cause, send); } };

  const app = Fastify({ logger: true });
  await app.register(websocket, { options: { maxPayload: MAX_WEBSOCKET_PAYLOAD } });
  app.get("/health", async () => ({ ok: true }));
  app.get("/ws", { websocket: true }, (connection) => {
    if (socket?.readyState === WEBSOCKET_OPEN) socket.close(4001, "Superseded by a newer control connection.");
    socket = connection;
    send({ type: "connected", protocolVersion: 1, sessionId: manager.getSession().sessionId });
    void (async () => { await sendSnapshot(); await sendSessions(); await sendFiles(); })();
    connection.on("message", async (raw, binary) => {
      if (binary) return send({ type: "error", error: { code: "invalid_protocol_payload", message: "Binary WebSocket messages are not supported.", recoverable: true } });
      let input: unknown;
      try { input = JSON.parse(raw.toString()); } catch { return send({ type: "error", error: { code: "invalid_protocol_payload", message: "Malformed JSON.", recoverable: true } }); }
      const parsed = parseClientCommand(input);
      if (!parsed.success) return send({ type: "error", error: parsed.error });
      if (parsed.data.type === "list_files") { send({ type: "command_ack", commandId: parsed.data.id, accepted: true }); return void sendFiles(parsed.data.path); }
      if (parsed.data.type === "read_file") { send({ type: "command_ack", commandId: parsed.data.id, accepted: true }); return void sendPreview(parsed.data.path); }
      const rejection = await controller.preflight(parsed.data);
      if (rejection) return send({ type: "command_ack", commandId: parsed.data.id, accepted: false, error: rejection });
      send({ type: "command_ack", commandId: parsed.data.id, accepted: true });
      if (parsed.data.type === "list_sessions") return void sendSessions();
      void controller.dispatch(parsed.data).then(async (failure) => {
        if (failure) return send({ type: "error", error: failure });
        if (["new_session", "switch_session", "set_model", "set_thinking_level", "compact"].includes(parsed.data.type)) await sendSnapshot();
        if (parsed.data.type === "new_session" || parsed.data.type === "switch_session") await sendSessions();
      });
    });
    connection.on("close", () => { if (socket === connection) socket = undefined; });
  });
  app.addHook("onClose", async () => { if (socket?.readyState === WEBSOCKET_OPEN) socket.close(1001, "Server is shutting down."); socket = undefined; await manager.dispose(); });
  return app;
}
function webModel(value: PiModel): WebModel { return { provider: value.provider, id: value.id, name: value.name ?? value.id, supportsThinking: value.reasoning !== undefined, ...(value.contextWindow ? { contextWindow: value.contextWindow } : {}) }; }
function sendFileError(cause: unknown, send: (event: ServerEvent) => void) { const failure = cause instanceof WorkspaceFileError ? cause : new WorkspaceFileError("file_read_failed", "The requested file could not be read."); send({ type: "error", error: { code: failure.code, message: failure.message, recoverable: true } }); }
