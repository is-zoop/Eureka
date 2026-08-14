import { randomUUID } from "node:crypto";
import type { ServerEvent, WebError, WebMessage, WebToolExecution } from "@pi-web/protocol";

export const WEB_OUTPUT_LIMIT = 1024 * 1024;
function jsonValue(value: unknown): unknown {
  try { const serialized = JSON.stringify(value); return serialized.length > WEB_OUTPUT_LIMIT ? { truncated: true, preview: `${serialized.slice(0, WEB_OUTPUT_LIMIT)}\n[Output truncated at 1 MiB]` } : JSON.parse(serialized); } catch { return undefined; }
}
function error(code: string, message: string): WebError { return { code, message, recoverable: true }; }

export class PiEventNormalizer {
  private readonly messageIds = new WeakMap<object, string>();
  private readonly streamedCharacters = new Map<string, number>();
  private activeAssistantMessageId?: string;
  private messageId(message: unknown): string { if (typeof message !== "object" || message === null) return randomUUID(); const existing = this.messageIds.get(message); if (existing) return existing; const id = randomUUID(); this.messageIds.set(message, id); return id; }
  normalize(event: unknown): ServerEvent[] {
    if (typeof event !== "object" || event === null || !("type" in event)) return [];
    const value = event as Record<string, unknown>;
    switch (value.type) {
      case "agent_start": return [{ type: "agent_status", phase: "running" }];
      case "agent_end": return [{ type: "agent_status", phase: value.willRetry === true ? "retrying" : "idle" }];
      case "compaction_start": return [{ type: "agent_status", phase: "compacting" }];
      case "compaction_end": { const id = randomUUID(); return [{ type: "agent_status", phase: "idle" }, { type: "message_start", messageId: id, role: "system" }, { type: "message_end", message: { id, role: "system", content: "Context compacted.", createdAt: Date.now() } }]; }
      case "auto_retry_start": return [{ type: "agent_status", phase: "retrying" }];
      case "auto_retry_end": return [{ type: "agent_status", phase: "idle" }];
      case "message_start": { const message = value.message as Record<string, unknown>; if (role(message?.role) !== "assistant") return []; const id = this.messageId(message); this.activeAssistantMessageId = id; return [{ type: "message_start", messageId: id, role: "assistant" }]; }
      case "message_update": return this.messageUpdate(value);
      case "message_end": { const message = value.message as Record<string, unknown>; if (role(message?.role) !== "assistant") return []; const item = this.webMessage(value.message, this.activeAssistantMessageId); this.activeAssistantMessageId = undefined; return [{ type: "message_end", message: item }]; }
      case "tool_execution_start": return [{ type: "tool_start", tool: { id: String(value.toolCallId), name: String(value.toolName), input: jsonValue(value.args) ?? null, status: "running", startedAt: Date.now() } }];
      case "tool_execution_update": { const output=jsonValue(value.partialResult) ?? null; const delta=this.limit(`tool:${String(value.toolCallId)}`,toolText(value.partialResult)); return [{ type: "tool_update", toolId: String(value.toolCallId), output, ...(delta ? { delta } : {}) }]; }
      case "tool_execution_end": { const success = value.isError !== true; return [{ type: "tool_end", toolId: String(value.toolCallId), success, finishedAt: Date.now(), ...(success ? { output: jsonValue(value.result) ?? null } : { error: error("tool_execution_failed", "Tool execution failed.") }) }]; }
      default: return [];
    }
  }
  private messageUpdate(event: Record<string, unknown>): ServerEvent[] {
    const update = event.assistantMessageEvent as Record<string, unknown>;
    const id = this.activeAssistantMessageId ?? this.messageId(event.message);
    if (update?.type === "text_delta") { const delta=this.limit(`message:${id}`,String(update.delta ?? "")); return delta ? [{ type: "message_delta", messageId: id, delta }] : []; }
    if (update?.type === "thinking_delta") { const delta=this.limit(`thinking:${id}`,String(update.delta ?? "")); return delta ? [{ type: "thinking_delta", messageId: id, delta }] : []; }
    return [];
  }
  private webMessage(message: unknown, id = this.messageId(message)): WebMessage {
    const value = message as Record<string, unknown>;
    return { id, role: role(value?.role), content: jsonValue(value?.content) ?? null, createdAt: Date.now(), ...(value?.isError === true ? { isError: true } : {}) };
  }
  private limit(key: string, value: string): string {
    const used=this.streamedCharacters.get(key) ?? 0;
    if (!value || used >= WEB_OUTPUT_LIMIT) return "";
    const remaining=WEB_OUTPUT_LIMIT-used;
    if (value.length <= remaining) { this.streamedCharacters.set(key, used+value.length); return value; }
    this.streamedCharacters.set(key, WEB_OUTPUT_LIMIT);
    return `${value.slice(0, remaining)}\n[Output truncated at 1 MiB]`;
  }
}
function role(value: unknown): "user" | "assistant" | "system" { return value === "user" || value === "system" ? value : "assistant"; }
function toolText(value: unknown): string { const v=value as {content?:unknown}; if(typeof v?.content==="string") return v.content; if(Array.isArray(v?.content)) return v.content.map(x=>typeof x==="object"&&x?String((x as {text?:unknown}).text??""):"").join(""); return ""; }
