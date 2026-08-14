import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { parseServerEvent } from "@pi-web/protocol";
import { loadServerConfig } from "../src/config.js";
import { PiEventNormalizer, WEB_OUTPUT_LIMIT } from "../src/pi/event-normalizer.js";
import { PiSessionController, toWebSessionSummaries } from "../src/pi/session-controller.js";
import { WorkspaceFiles } from "../src/workspace-files.js";
import { createServer } from "../src/app.js";

test("uses localhost defaults and canonical workspace", async () => {
  const config = await loadServerConfig(["--workspace", process.cwd()], {});
  assert.equal(config.host, "127.0.0.1"); assert.equal(config.port, 3001); assert.ok(config.workspace.length > 0);
});
test("rejects missing workspace and invalid port", async () => {
  await assert.rejects(() => loadServerConfig([], {}));
  await assert.rejects(() => loadServerConfig(["--workspace", process.cwd()], { PI_WEB_PORT: "99999" }));
});
test("normalizes observed Pi fixtures into valid protocol events", () => {
  const normalizer = new PiEventNormalizer();
  const fixtures: unknown[] = [{ type: "agent_start" }, { type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", delta: "hello" } }, { type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_delta", delta: "think" } }, { type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "npm test" } }, { type: "tool_execution_update", toolCallId: "tool-1", partialResult: { content: "PASS" } }, { type: "tool_execution_end", toolCallId: "tool-1", isError: false, result: { content: "PASS" } }, { type: "agent_end", willRetry: false }];
  const events = fixtures.flatMap((fixture) => normalizer.normalize(fixture));
  assert.equal(events.length, 7); for (const event of events) assert.equal(parseServerEvent(event).success, true);
  assert.deepEqual(normalizer.normalize({ type: "unknown_pi_event" }), []);
});
test("truncates streamed output at the web safety limit", () => {
  const normalizer = new PiEventNormalizer();
  normalizer.normalize({ type: "message_start", message: { role: "assistant" } });
  const events = normalizer.normalize({ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", delta: "x".repeat(WEB_OUTPUT_LIMIT + 64) } });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "message_delta");
  if (events[0]?.type === "message_delta") assert.match(events[0].delta, /Output truncated at 1 MiB/);
  assert.deepEqual(normalizer.normalize({ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", delta: "later" } }), []);
});
test("maps workspace session summaries newest first without paths", () => {
  const sessions = toWebSessionSummaries([
    { id: "old", name: "", created: new Date(1), modified: new Date(10), messageCount: 1, firstMessage: "Older message" },
    { id: "new", name: "Named", created: new Date(2), modified: new Date(20), messageCount: 2, firstMessage: "Newer message" },
  ]);
  assert.deepEqual(sessions, [
    { id: "new", name: "Named", createdAt: 2, modifiedAt: 20, messageCount: 2, preview: "Newer message" },
    { id: "old", createdAt: 1, modifiedAt: 10, messageCount: 1, preview: "Older message" },
  ]);
  assert.equal(JSON.stringify(sessions).includes("path"), false);
});
test("rejects a new session while the agent is running", async () => {
  const controller = new PiSessionController({ getSession: () => ({ isStreaming: true }) } as never);
  const result = await controller.preflight({ id: "cmd", type: "new_session" });
  assert.deepEqual(result, { code: "agent_busy", message: "Stop the agent before changing sessions.", recoverable: true });
});
test("rejects model settings while the agent is running", async () => {
  const controller = new PiSessionController({ getSession: () => ({ isIdle: false }) } as never);
  const result = await controller.preflight({ id: "cmd", type: "set_thinking_level", level: "high" });
  assert.deepEqual(result, { code: "agent_busy", message: "Stop the agent before changing this setting.", recoverable: true });
});
test("lists only safe workspace files and previews text", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-web-files-"));
  await mkdir(path.join(workspace, "src")); await mkdir(path.join(workspace, "node_modules"));
  await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(workspace, "src", "app.ts"), "export const answer = 42;\n");
  await writeFile(path.join(workspace, "ignored.txt"), "hidden"); await writeFile(path.join(workspace, "node_modules", "hidden.js"), "hidden");
  const files = new WorkspaceFiles(workspace);
  assert.deepEqual((await files.list()).map((entry) => entry.path), ["src"]);
  assert.deepEqual(await files.preview("src/app.ts"), { kind: "text", path: "src/app.ts", content: "export const answer = 42;\n", truncated: false });
  await assert.rejects(() => files.preview("../outside.txt"));
});
test("gateway serves fake runtime without a provider and replaces control sockets", async () => {
  let disposed = 0;
  const session = { sessionId: "fake-session", isCompacting: false, isStreaming: false, sessionName: "Fake", model: { provider: "fake", id: "model", name: "Fake model" }, thinkingLevel: "low", getAvailableThinkingLevels: () => ["low"], messages: [], getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 }), getContextUsage: () => undefined };
  const manager = { getSession: () => session, getRuntime: () => ({ services: { modelRuntime: { getAvailable: async () => [session.model] } } }), dispose: async () => { disposed += 1; } };
  const controller = { listSessions: async () => [], preflight: async () => undefined, dispatch: async () => undefined };
  const files = { list: async () => [], preview: async () => ({ kind: "unavailable", path: "missing.txt", reason: "unsupported" }) };
  const app = await createServer({ workspace: process.cwd(), host: "127.0.0.1", port: 0 }, { manager: manager as never, controller: controller as never, files: files as never });
  await app.listen({ host: "127.0.0.1", port: 0 }); const port = (app.server.address() as AddressInfo).port;
  const connect = (received?: unknown[]) => new Promise<WebSocket>((resolve) => { const client = new WebSocket(`ws://127.0.0.1:${port}/ws`); if (received) client.on("message", (data) => received.push(JSON.parse(data.toString()))); client.once("open", () => resolve(client)); });
  let first: WebSocket | undefined; let second: WebSocket | undefined;
  try {
    const received: unknown[] = []; first = await connect(received);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(received.slice(0, 4).map((event) => (event as { type: string }).type), ["connected", "snapshot", "sessions", "file_list"]);
    first.send("not-json"); await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal((received.at(-1) as { type: string }).type, "error");
    const closed = new Promise<number>((resolve) => first!.once("close", (code) => resolve(code))); second = await connect(); assert.equal(await closed, 4001);
  } finally { first?.terminate(); second?.terminate(); await app.close(); }
  assert.equal(disposed, 1);
});
