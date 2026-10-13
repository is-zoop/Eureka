import type { AssistantMessage } from "./types";

interface ThinkingTiming { startedAt: number; finishedAt?: number; estimated: boolean }
const observedTimings = new Map<string, ThinkingTiming>();
const MAX_TIMINGS = 512;
const STORAGE_KEY = "eureka-thinking-timings-v1";
let hydrated = false;

function hydrateTimings(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return;
    for (const item of saved.slice(-MAX_TIMINGS)) {
      if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string") continue;
      const value = item[1] as ThinkingTiming | null;
      if (!value || !Number.isFinite(value.startedAt) || !Number.isFinite(value.finishedAt)
        || value.finishedAt! < value.startedAt || typeof value.estimated !== "boolean") continue;
      if (!observedTimings.has(item[0])) observedTimings.set(item[0], value);
    }
  } catch { /* Browser storage may be unavailable; in-memory timings still survive folding. */ }
}

function saveTimings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...observedTimings].filter(([, value]) => value.finishedAt !== undefined).slice(-MAX_TIMINGS)));
  } catch { /* Keep the in-memory record when storage is unavailable. */ }
}

export function thinkingTimingKey(sessionId: string | undefined, messageTimestamp: number | undefined, blockIndex: number, entryId?: string): string | undefined {
  if (!sessionId) return undefined;
  return entryId ? `${sessionId}:entry:${entryId}:${blockIndex}`
    : Number.isFinite(messageTimestamp) ? `${sessionId}:${messageTimestamp}:${blockIndex}` : undefined;
}

function preferredTiming(first: ThinkingTiming | undefined, second: ThinkingTiming | undefined): ThinkingTiming | undefined {
  const finished = [first, second].filter((value): value is ThinkingTiming => value?.finishedAt !== undefined);
  return finished.find((value) => !value.estimated) ?? finished[0] ?? first ?? second;
}

export function getMessageThinkingTiming(sessionId: string | undefined, timestamp: number | undefined, blockIndex: number, entryId?: string): ThinkingTiming | undefined {
  return preferredTiming(getThinkingTiming(thinkingTimingKey(sessionId, timestamp, blockIndex, entryId)),
    getThinkingTiming(thinkingTimingKey(sessionId, timestamp, blockIndex)));
}

export function aliasThinkingTiming(sourceKey: string | undefined, targetKey: string | undefined): void {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const existing = getThinkingTiming(targetKey);
  const value = preferredTiming(existing, getThinkingTiming(sourceKey));
  if (!value || value === existing) return;
  observedTimings.set(targetKey, value);
  saveTimings();
}

/** Associate live observations with the permanent entry before replacing live messages with history. */
export function bindMessageThinkingTimings(sessionId: string | undefined, message: AssistantMessage, entryId?: string): void {
  message.content.forEach((block, index) => {
    if (block.type !== "thinking") return;
    const liveKey = thinkingTimingKey(sessionId, message.timestamp, index);
    const entryKey = thinkingTimingKey(sessionId, message.timestamp, index, entryId);
    if (Number.isFinite(message.generationCompletedAt)) {
      finishThinkingTiming(liveKey, message.generationCompletedAt!, true);
    }
    aliasThinkingTiming(liveKey, entryKey);
    if (Number.isFinite(message.generationCompletedAt)) {
      finishThinkingTiming(entryKey, message.generationCompletedAt!, true);
    }
    rememberThinkingDuration(entryKey, estimateThinkingSeconds(message), true);
  });
}

export function getThinkingTiming(key: string | undefined): ThinkingTiming | undefined {
  hydrateTimings();
  return key ? observedTimings.get(key) : undefined;
}

export function isThinkingActive(source: { isStreaming?: boolean; message: AssistantMessage }, blockIndex: number, sessionId?: string): boolean {
  return Boolean(source.isStreaming && source.message.content[blockIndex]?.type === "thinking"
    && blockIndex === source.message.content.length - 1
    && getThinkingTiming(thinkingTimingKey(sessionId, source.message.timestamp, blockIndex))?.finishedAt === undefined);
}

export function startThinkingTiming(key: string | undefined, now: number, estimated = false): void {
  hydrateTimings();
  if (!key || observedTimings.has(key)) return;
  observedTimings.set(key, { startedAt: now, estimated });
}

export function finishThinkingTiming(key: string | undefined, now: number, estimated = false): void {
  const timing = getThinkingTiming(key);
  if (!key || !timing || timing.finishedAt !== undefined) return;
  observedTimings.set(key, { ...timing, finishedAt: Math.max(timing.startedAt, now), estimated: timing.estimated || estimated });
  if (observedTimings.size > MAX_TIMINGS) {
    for (const [oldKey, value] of observedTimings) {
      if (observedTimings.size <= MAX_TIMINGS) break;
      if (value.finishedAt !== undefined) observedTimings.delete(oldKey);
    }
  }
  saveTimings();
}

/** Retain a displayed historical estimate even if a later render lacks its tree timestamp. */
export function rememberThinkingDuration(key: string | undefined, seconds: number | undefined, estimated = true): void {
  if (!key || seconds === undefined || !Number.isFinite(seconds) || seconds < 0 || getThinkingTiming(key)) return;
  startThinkingTiming(key, 0, estimated);
  finishThinkingTiming(key, seconds * 1000, estimated);
}

/** Some providers replace the partial message timestamp when committing their response. */
export function transferMessageThinking(sessionId: string | undefined, fromTimestamp: number | undefined, toTimestamp: number | undefined): void {
  if (!sessionId || !Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp === toTimestamp) return;
  hydrateTimings();
  const prefix = `${sessionId}:${fromTimestamp}:`;
  for (const [key, timing] of [...observedTimings]) {
    if (!key.startsWith(prefix)) continue;
    const nextKey = `${sessionId}:${toTimestamp}:${key.slice(prefix.length)}`;
    const existing = observedTimings.get(nextKey);
    if (!existing || (existing.estimated && !timing.estimated)) observedTimings.set(nextKey, timing);
  }
  saveTimings();
}

export function observeThinkingSnapshot(sessionId: string | undefined, message: AssistantMessage, now: number): void {
  const index = message.content.length - 1;
  const block = message.content[index];
  if (block?.type === "thinking") startThinkingTiming(thinkingTimingKey(sessionId, message.timestamp, index), now, true);
}

export function observeThinkingEvent(sessionId: string | undefined, messageTimestamp: number | undefined,
  event: { type: string; contentIndex?: number }, now: number): void {
  const index = event.contentIndex;
  if (index === undefined || !Number.isInteger(index) || index < 0) return;
  const key = thinkingTimingKey(sessionId, messageTimestamp, index);
  if (event.type === "thinking_start" || event.type === "thinking_delta") {
    startThinkingTiming(key, now, event.type !== "thinking_start");
  } else if (event.type === "thinking_end") {
    finishThinkingTiming(key, now);
  }
  if (["thinking_start", "text_start", "toolcall_start"].includes(event.type)) {
    for (let previous = 0; previous < index; previous++) {
      finishThinkingTiming(thinkingTimingKey(sessionId, messageTimestamp, previous), now);
    }
  }
}

export function finishMessageThinking(sessionId: string | undefined, messageTimestamp: number | undefined, now: number, estimated = false): void {
  if (!sessionId || !Number.isFinite(messageTimestamp)) return;
  const prefix = `${sessionId}:${messageTimestamp}:`;
  for (const key of observedTimings.keys()) if (key.startsWith(prefix)) finishThinkingTiming(key, now, estimated);
}

/** Old files contain request start and entry completion, but no per-thinking-block clock. */
export function estimateThinkingSeconds(message: AssistantMessage, completedAt: number | undefined = message.generationCompletedAt): number | undefined {
  if (typeof message.timestamp !== "number" || typeof completedAt !== "number"
    || !Number.isFinite(message.timestamp) || !Number.isFinite(completedAt) || completedAt < message.timestamp) return undefined;
  if (message.content.filter((block) => block.type === "thinking").length !== 1) return undefined;
  return Math.round((completedAt - message.timestamp) / 1000);
}
