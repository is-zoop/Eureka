import { getThinkingPreview } from "./thinking-preview";
import { rememberThinkingPreview } from "./thinking-preview-cache";

interface CachedThinking { request: Promise<string>; preview?: string }
const cache = new Map<string, CachedThinking>();
const MAX_ENTRIES = 100;
const keyFor = (sessionId: string, entryId: string, blockIndex: number) => `${sessionId}:${entryId}:${blockIndex}`;

export function getCachedThinkingPreview(sessionId?: string, entryId?: string, blockIndex = 0): string | undefined {
  return sessionId && entryId ? cache.get(keyFor(sessionId, entryId, blockIndex))?.preview : undefined;
}

export function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = keyFor(sessionId, entryId, blockIndex);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.request;
  }
  const entry: CachedThinking = {
    request: fetch(`/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { thinking?: unknown };
        if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
        entry.preview = getThinkingPreview(data.thinking);
        rememberThinkingPreview(sessionId, undefined, blockIndex, data.thinking, entryId);
        return data.thinking;
      }).catch((error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      }),
  };
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return entry.request;
}
