import type { ContextUsage } from "./pi-types";

export type ContextCategory = "system" | "tools" | "skills" | "messages" | "other";
export interface ContextDetails {
  sessionId: string;
  source: "live" | "history" | "snapshot";
  model: string | null;
  usage: ContextUsage;
  usageEstimated: boolean;
  breakdown: Array<{ id: ContextCategory; tokens: number | null }>;
  reserveTokens: number | null;
  autoCompactionEnabled: boolean | null;
  canCompact: boolean;
}

/** UI controls remain owned by the active chat, including automatic compaction. */
export interface ContextControls {
  sessionId: string;
  busy: boolean;
  isCompacting: boolean;
  error: string | null;
  result: { tokensBefore: number; estimatedTokensAfter: number; reason: string } | null;
  compact: () => Promise<void>;
  abort: () => Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Ignore image payloads, credentials and transport metadata in weight estimates. */
function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).join("\n");
  if (!record(value) || value.type === "image" || value.type === "audio") return "";
  if (value.type === "toolCall") return `${value.name ?? value.toolName ?? ""} ${JSON.stringify(value.arguments ?? value.input ?? {})}`;
  return [value.text, value.thinking, value.summary, value.content].map(contentText).filter(Boolean).join("\n");
}

export function estimateTextTokens(text: string): number {
  let wide = 0;
  let other = 0;
  for (const character of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)) wide++;
    else other++;
  }
  return Math.ceil(wide + other / 4);
}

export function estimateMessageTokens(messages: readonly unknown[]): number {
  return messages.reduce<number>((sum, message) => {
    if (!record(message)) return sum;
    return sum + estimateTextTokens(contentText(message.content ?? message.summary)) + 4;
  }, 0);
}

export function buildContextDetails(input: {
  sessionId: string;
  source: "live" | "history";
  model?: string;
  contextWindow?: number;
  usage?: ContextUsage | null;
  messages: readonly unknown[];
  systemPrompt?: string;
  tools?: readonly { name: string; description?: string; parameters?: unknown }[];
  reserveTokens?: number;
  autoCompactionEnabled?: boolean;
  canCompact?: boolean;
}): ContextDetails {
  const skills = input.systemPrompt?.match(/<available_skills>[\s\S]*?<\/available_skills>/g)?.join("\n") ?? "";
  const system = input.systemPrompt?.replace(/<available_skills>[\s\S]*?<\/available_skills>/g, "");
  const raw: Array<{ id: ContextCategory; tokens: number | null }> = [
    { id: "system", tokens: system === undefined ? null : estimateTextTokens(system) },
    { id: "tools", tokens: input.tools === undefined ? null : input.tools.length === 0 ? 0 : estimateTextTokens(JSON.stringify(input.tools.map(({ name, description, parameters }) => ({ name, description, parameters })))) },
    { id: "skills", tokens: input.systemPrompt === undefined ? null : estimateTextTokens(skills) },
    { id: "messages", tokens: estimateMessageTokens(input.messages) },
  ];
  const knownTotal = raw.reduce((sum, part) => sum + (part.tokens ?? 0), 0);
  const reported = typeof input.usage?.tokens === "number" && Number.isFinite(input.usage.tokens) ? Math.max(0, input.usage.tokens) : null;
  const usageEstimated = reported == null || input.usage?.estimated === true;
  const tokens = reported == null ? knownTotal : Math.max(0, reported);
  const windowValue = input.usage?.contextWindow ?? input.contextWindow ?? 0;
  const contextWindow = Number.isFinite(windowValue) ? Math.max(0, windowValue) : 0;
  const complete = raw.every((part) => part.tokens !== null);
  let breakdown = raw;
  if (complete && knownTotal > 0) {
    // These are explicitly labelled text-weight estimates calibrated to the
    // current context total, never to cumulative session input/output usage.
    let allocated = 0;
    breakdown = raw.map((part, index) => {
      const value = index === raw.length - 1 ? tokens - allocated : Math.min(tokens - allocated, Math.round((part.tokens ?? 0) / knownTotal * tokens));
      allocated += value;
      return { id: part.id, tokens: value };
    });
  } else if (reported != null) {
    const messages = Math.min(tokens, raw.find((part) => part.id === "messages")?.tokens ?? 0);
    breakdown = raw.map((part) => part.id === "messages" ? { ...part, tokens: messages } : part);
    breakdown.push({ id: "other", tokens: Math.max(0, tokens - messages) });
  }
  return {
    sessionId: input.sessionId, source: input.source, model: input.model ?? null,
    usage: { tokens, contextWindow, percent: contextWindow > 0 ? tokens / contextWindow * 100 : null, estimated: usageEstimated },
    usageEstimated, breakdown,
    reserveTokens: input.reserveTokens === undefined || !Number.isFinite(input.reserveTokens) ? null : Math.max(0, Math.min(contextWindow || Infinity, input.reserveTokens)),
    autoCompactionEnabled: input.autoCompactionEnabled ?? null,
    canCompact: input.canCompact ?? true,
  };
}

export function contextCapacity(usage: ContextUsage, reserveTokens: number | null) {
  const capacity = Math.max(0, usage.contextWindow);
  const used = usage.tokens;
  const free = used === null || !capacity ? null : Math.max(0, capacity - used);
  const reserved = free === null || reserveTokens === null ? null : Math.min(free, Math.max(0, reserveTokens));
  return { used, free, reserved, available: free === null ? null : Math.max(0, free - (reserved ?? 0)) };
}
