import type { AssistantMessage } from "./types";
import { getThinkingPreview } from "./thinking-preview";

const previews = new Map<string, string>();
const partials = new Map<string, string>();
const MAX_PREVIEWS = 512;
const MAX_PARTIAL_CHARS = 4096;

function setPartial(key: string, raw: string): void {
  partials.delete(key);
  partials.set(key, raw);
  while (partials.size > 32) partials.delete(partials.keys().next().value!);
}

function keys(sessionId: string | undefined, timestamp: number | undefined, index: number, entryId?: string): string[] {
  if (!sessionId || !Number.isInteger(index) || index < 0) return [];
  return [entryId ? `${sessionId}:entry:${entryId}:${index}` : undefined,
    Number.isFinite(timestamp) ? `${sessionId}:time:${timestamp}:${index}` : undefined].filter((key): key is string => Boolean(key));
}

function save(key: string, preview: string): void {
  if (!preview) return;
  previews.delete(key);
  previews.set(key, preview);
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
}

export function getStoredThinkingPreview(sessionId?: string, timestamp?: number, index = 0, entryId?: string): string | undefined {
  for (const key of keys(sessionId, timestamp, index, entryId)) {
    const preview = previews.get(key);
    if (preview) return preview;
  }
  return undefined;
}

export function rememberThinkingPreview(sessionId: string | undefined, timestamp: number | undefined, index: number, thinking: string, entryId?: string): void {
  const preview = getThinkingPreview(thinking);
  // Deferred snapshots and empty streamed placeholders must not erase an existing excerpt.
  if (!preview) return;
  for (const key of keys(sessionId, timestamp, index, entryId)) save(key, preview);
}

export function rememberMessageThinkingPreviews(sessionId: string | undefined, message: AssistantMessage, entryId?: string, streaming = false): void {
  message.content.forEach((block, index) => {
    if (block.type !== "thinking") return;
    const raw = block.thinking.trim() ? block.thinking : block.preview ?? "";
    rememberThinkingPreview(sessionId, message.timestamp, index, raw, entryId);
    const retained = getStoredThinkingPreview(sessionId, message.timestamp, index, entryId);
    if (retained) for (const key of keys(sessionId, message.timestamp, index, entryId)) save(key, retained);
    if (streaming && index === message.content.length - 1 && !block.deferred) {
      const key = keys(sessionId, message.timestamp, index)[0];
      if (key) setPartial(key, block.thinking.slice(0, MAX_PARTIAL_CHARS));
    } else if (!streaming) {
      for (const key of keys(sessionId, message.timestamp, index)) partials.delete(key);
    }
  });
}

export function observeThinkingPreviewEvent(sessionId: string | undefined, timestamp: number | undefined,
  event: { type: string; contentIndex?: number; delta?: string; content?: string }): void {
  if (event.contentIndex === undefined) return;
  const index = event.contentIndex;
  const key = keys(sessionId, timestamp, index)[0];
  if (!key) return;
  if (event.type === "thinking_start") setPartial(key, "");
  else if (event.type === "thinking_delta" && typeof event.delta === "string") {
    const raw = ((partials.get(key) ?? "") + event.delta).slice(0, MAX_PARTIAL_CHARS);
    setPartial(key, raw);
    rememberThinkingPreview(sessionId, timestamp, index, raw);
  } else if (event.type === "thinking_end") {
    const raw = typeof event.content === "string" && event.content.trim() ? event.content : partials.get(key) ?? "";
    rememberThinkingPreview(sessionId, timestamp, index, raw);
    partials.delete(key);
  }
}

export function transferThinkingPreviews(sessionId: string | undefined, fromTimestamp: number | undefined, toTimestamp: number | undefined): void {
  if (!sessionId || !Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp === toTimestamp) return;
  const prefix = `${sessionId}:time:${fromTimestamp}:`;
  for (const [key, preview] of [...previews]) {
    if (key.startsWith(prefix)) save(`${sessionId}:time:${toTimestamp}:${key.slice(prefix.length)}`, preview);
  }
}
