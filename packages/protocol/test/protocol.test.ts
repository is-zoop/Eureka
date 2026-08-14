import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClientCommand,
  parseServerEvent,
  PROTOCOL_VERSION,
  serializeClientCommand,
  serializeServerEvent,
  type ClientCommand,
  type ServerEvent,
} from "../src/index.js";

const commands: ClientCommand[] = [
  { id: "cmd-1", type: "prompt", text: "Inspect this", images: [{ mimeType: "image/png", data: "aGVsbG8=" }] },
  { id: "cmd-2", type: "abort" },
  { id: "cmd-3", type: "set_model", provider: "openai", modelId: "gpt-5" },
  { id: "cmd-4", type: "set_thinking_level", level: "high" },
  { id: "cmd-5", type: "compact", instructions: "Preserve decisions" },
  { id: "cmd-6", type: "new_session" },
  { id: "cmd-7", type: "switch_session", sessionId: "session-2" },
  { id: "cmd-8", type: "list_sessions" },
  { id: "cmd-9", type: "list_files" },
  { id: "cmd-10", type: "list_files", path: "src" },
  { id: "cmd-11", type: "read_file", path: "src/app.ts" },
];

const snapshot = {
  sessionId: "session-1",
  sessionName: "Protocol test",
  cwd: "E:/Eureka",
  phase: "idle" as const,
  model: { provider: "openai", id: "gpt-5", name: "GPT-5", supportsThinking: true, contextWindow: 200000 },
  thinkingLevel: "high",
  availableModels: [{ provider: "openai", id: "gpt-5", name: "GPT-5", supportsThinking: true, contextWindow: 200000 }],
  availableThinkingLevels: ["low", "high"],
  messages: [{ id: "message-1", role: "assistant" as const, content: [{ type: "text", text: "Hello" }], createdAt: 1 }],
  context: { usedTokens: 10, maxTokens: 100, percentage: 10 },
  usage: { inputTokens: 10, outputTokens: 2, cost: 0.01 },
};

const events: ServerEvent[] = [
  { type: "connected", protocolVersion: PROTOCOL_VERSION, sessionId: "session-1" },
  { type: "command_ack", commandId: "cmd-1", accepted: true },
  { type: "command_ack", commandId: "cmd-2", accepted: false, error: { code: "busy", message: "Agent is busy", recoverable: true } },
  { type: "snapshot", snapshot },
  { type: "sessions", sessions: [{ id: "session-1", name: "Protocol test", createdAt: 1, modifiedAt: 2, messageCount: 1, preview: "Hello" }] },
  { type: "file_list", entries: [{ path: "src", name: "src", kind: "directory", modifiedAt: 1 }] },
  { type: "file_preview", preview: { kind: "text", path: "src/app.ts", content: "export {}", truncated: false } },
  { type: "message_start", messageId: "message-2", role: "assistant" },
  { type: "message_delta", messageId: "message-2", delta: "Hello" },
  { type: "thinking_delta", messageId: "message-2", delta: "Reasoning" },
  { type: "message_end", message: { id: "message-2", role: "assistant", content: "Hello", createdAt: 2 } },
  { type: "tool_start", tool: { id: "tool-1", name: "bash", input: { command: "npm test" }, status: "running", startedAt: 3 } },
  { type: "tool_update", toolId: "tool-1", delta: "PASS\n", output: { content: "PASS" } },
  { type: "tool_end", toolId: "tool-1", success: true, output: { content: "PASS" } },
  { type: "agent_status", phase: "running" },
  { type: "usage", usage: { inputTokens: 10 }, context: { percentage: 20 } },
  { type: "error", error: { code: "provider_error", message: "Rate limited", recoverable: true } },
];

test("parses and serializes every client command", () => {
  for (const command of commands) {
    assert.deepEqual(parseClientCommand(JSON.parse(serializeClientCommand(command))), { success: true, data: command });
  }
});

test("parses and serializes every server event", () => {
  for (const event of events) {
    assert.deepEqual(parseServerEvent(JSON.parse(serializeServerEvent(event))), { success: true, data: event });
  }
});

test("rejects malformed commands and unsafe JSON values", () => {
  assert.equal(parseClientCommand({ id: "", type: "abort" }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "prompt", text: "x", images: [{ mimeType: "image/svg+xml", data: "abc" }] }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "set_model", provider: "openai" }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "list_sessions", extra: true }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "read_file", path: "../secret" }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "read_file", path: "C:\\secret" }).success, false);
  assert.equal(parseClientCommand({ id: "cmd", type: "prompt", text: "x", images: [{ mimeType: "image/png", data: "a".repeat(27_962_029) }] }).success, false);
  assert.equal(parseServerEvent({ type: "agent_status", phase: "paused" }).success, false);
  assert.equal(parseServerEvent({ type: "tool_update", toolId: "tool-1" }).success, false);
  assert.equal(parseServerEvent({ type: "tool_end", toolId: "tool-1", success: false }).success, false);
  assert.equal(parseServerEvent({ type: "usage", usage: { cost: Number.NaN } }).success, false);
  assert.equal(parseServerEvent({ type: "snapshot", snapshot: { ...snapshot, availableThinkingLevels: [""] } }).success, false);
  assert.equal(parseServerEvent({ type: "sessions", sessions: [{ id: "s", createdAt: 1, modifiedAt: 2, messageCount: 0, preview: "x", path: "C:/secret" }] }).success, false);
  assert.equal(parseServerEvent({ type: "file_preview", preview: { kind: "image", path: "x.png", mimeType: "image/svg+xml", data: "aGVsbG8=" } }).success, false);
});

test("rejects unknown event fields and returns safe validation errors", () => {
  const result = parseServerEvent({ type: "connected", protocolVersion: 1, sessionId: "session-1", internalPiState: {} });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "invalid_protocol_payload");
    assert.equal(result.error.recoverable, true);
    assert.ok(Array.isArray(result.error.details));
  }
});
