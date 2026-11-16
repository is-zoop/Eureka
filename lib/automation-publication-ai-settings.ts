import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const PUBLICATION_AI_TIMEOUT_MS = 180_000;
export const PUBLICATION_AI_MAX_TOKENS = 8000;
export const PUBLICATION_AI_MAX_TIMEOUT_MS = 1_800_000;
export const PUBLICATION_AI_MAX_OUTPUT_TOKENS = 128_000;
export interface PublicationAiSettings {
  model: { provider: string; modelId: string } | null;
  thinkingLevel: ModelThinkingLevel | null;
  timeoutMs: number;
  maxTokens: number;
}
export const DEFAULT_PUBLICATION_AI_SETTINGS: PublicationAiSettings = { model: null, thinkingLevel: null, timeoutMs: PUBLICATION_AI_TIMEOUT_MS, maxTokens: PUBLICATION_AI_MAX_TOKENS };

export function parsePublicationAiSettings(value: unknown): PublicationAiSettings {
  const raw = value as PublicationAiSettings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).some(key => !["model", "thinkingLevel", "timeoutMs", "maxTokens"].includes(key))
    || (raw.model !== null && (!raw.model || typeof raw.model !== "object" || Array.isArray(raw.model)
      || Object.keys(raw.model).some(key => !["provider", "modelId"].includes(key))
      || [raw.model.provider, raw.model.modelId].some(part => typeof part !== "string" || !part.trim() || part.length > 256)))
    || (raw.thinkingLevel !== null && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(raw.thinkingLevel))) {
    throw new Error("Invalid publication AI settings");
  }
  const timeoutMs = raw.timeoutMs === undefined ? PUBLICATION_AI_TIMEOUT_MS : raw.timeoutMs, maxTokens = raw.maxTokens === undefined ? PUBLICATION_AI_MAX_TOKENS : raw.maxTokens;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > PUBLICATION_AI_MAX_TIMEOUT_MS || timeoutMs % 1000 !== 0
    || !Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > PUBLICATION_AI_MAX_OUTPUT_TOKENS) throw new Error("Invalid publication AI limits");
  return { model: raw.model ? { provider: raw.model.provider, modelId: raw.model.modelId } : null, thinkingLevel: raw.thinkingLevel, timeoutMs, maxTokens };
}
