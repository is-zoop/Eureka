import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../../../components/content/ansi";
import { getSessionDisplayTitle } from "../shared/session-display-title";

export interface SessionCompletion {
  sessionId: string;
  title: string;
  summary: string;
}

type CompletionListener = (completion: SessionCompletion) => void;

declare global {
  var __eurekaCompletionListeners: Set<CompletionListener> | undefined;
}

export function subscribeSessionCompletions(listener: CompletionListener): () => void {
  const listeners = globalThis.__eurekaCompletionListeners ??= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hasSessionCompletionListeners(): boolean {
  return Boolean(globalThis.__eurekaCompletionListeners?.size);
}

export function publishSessionCompletion(completion: SessionCompletion): void {
  for (const listener of globalThis.__eurekaCompletionListeners ?? []) listener(completion);
}

function excerpt(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit - 1).join("").trimEnd() + "…";
}

function summarizeReply(text: string): string {
  let fence: string | undefined;
  const prose = text.split(/\r?\n/).filter((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1][0];
    if (marker && (!fence || fence === marker)) {
      fence = fence ? undefined : marker;
      return false;
    }
    return !fence;
  });
  return excerpt(stripAnsi(prose.join("\n"))
    .replace(/^ {0,3}(?:#{1,6}|>|[-+*]|\d+\.)\s+/gm, "")
    .replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, "")
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ").trim(), 200);
}

export function buildSessionCompletion(
  entries: readonly SessionEntry[],
  start: number,
  name?: string,
): Omit<SessionCompletion, "sessionId"> | null {
  const last = entries.slice(start).findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (last?.type !== "message" || last.message.role !== "assistant" || last.message.stopReason !== "stop") return null;
  const first = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  const content = first?.type === "message" && first.message.role === "user" ? first.message.content : "";
  const firstMessage = typeof content === "string" ? content : content.find((block) => block.type === "text")?.text ?? "";
  const title = getSessionDisplayTitle({ name, firstMessage: firstMessage.slice(0, 4_000) }, "");
  const summary = last.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  return { title: excerpt(title, 100), summary: summarizeReply(summary.slice(0, 12_000)) };
}
