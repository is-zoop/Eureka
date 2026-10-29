import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { calculateContextTokens } from "@earendil-works/pi-coding-agent";
import { buildContextDetails, type ContextDetails } from "./context-details";
import type { AgentSessionLike } from "./pi-types";

interface SnapshotSession {
  inner: AgentSessionLike;
  onEvent(listener: (event: { type: string }) => void): () => void;
}

declare global {
  var __piContextSnapshotWrites: Map<string, Promise<boolean>> | undefined;
  var __piContextSnapshotObservers: WeakSet<object> | undefined;
}

export function describeLiveContext(inner: AgentSessionLike, sessionId = inner.sessionId): ContextDetails {
  const state = inner.agent.state;
  const messages = state?.messages ?? inner.sessionManager.buildSessionContext().messages;
  const latest = messages.at(-1);
  const reported = inner.getContextUsage();
  const estimated = latest?.role !== "assistant" || !latest.usage || ["error", "aborted"].includes(latest.stopReason) || calculateContextTokens(latest.usage) <= 0 || latest.provider !== inner.model?.provider || latest.model !== inner.model?.id;
  const settings = inner.settingsManager.getCompactionSettings();
  return buildContextDetails({
    sessionId, source: "live", model: inner.model ? `${inner.model.provider}/${inner.model.id}` : undefined,
    usage: reported ? { ...reported, estimated } : undefined, messages,
    systemPrompt: state?.systemPrompt, tools: state?.tools,
    reserveTokens: settings.reserveTokens, autoCompactionEnabled: inner.autoCompactionEnabled,
  });
}

export async function persistLiveContextSnapshot(inner: AgentSessionLike): Promise<void> {
  if (!inner.sessionFile || !existsSync(inner.sessionFile)) return;
  try {
    const details = describeLiveContext(inner);
    if (details.breakdown.some((part) => part.tokens === null)) return;
    await saveContextSnapshot(inner.sessionFile, contextRevision(inner.sessionManager.getBranch()), details);
  } catch (error) {
    console.warn("[context-snapshot] Unable to capture runtime counts", error);
  }
}

/** Also attaches to wrappers kept alive across Next.js hot reloads. */
export function observeContextSnapshots(session: SnapshotSession): void {
  const observed = globalThis.__piContextSnapshotObservers ??= new WeakSet();
  if (observed.has(session) || typeof session.onEvent !== "function") return;
  observed.add(session);
  session.onEvent((event) => {
    if (["prompt_done", "agent_end", "agent_settled", "compaction_end", "auto_compaction_end"].includes(event.type)) void persistLiveContextSnapshot(session.inner);
  });
  void persistLiveContextSnapshot(session.inner);
}

/** Display names, bookmarks and extension metadata do not enter model context. */
export function contextRevision(branch: readonly { id: string; type: string }[]): string | null {
  return branch.findLast((entry) => !["session_info", "label", "custom"].includes(entry.type))?.id ?? null;
}

const categories = new Set(["system", "tools", "skills", "messages", "other"]);
const count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Save counts only, beside the session; never persist prompts or tool schemas. */
export async function saveContextSnapshot(file: string, revision: string | null, details: ContextDetails): Promise<boolean> {
  if (!file) return false;
  const target = `${file}.context-usage.json`;
  const writes = globalThis.__piContextSnapshotWrites ??= new Map();
  const write = (writes.get(target) ?? Promise.resolve()).then(async () => {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, revision, details }), "utf8");
      await rename(temporary, target);
      return true;
    } catch (error) {
      console.warn("[context-snapshot] Unable to save numeric snapshot", target, (error as NodeJS.ErrnoException).code);
      return false;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
  writes.set(target, write);
  try {
    return await write;
  } finally {
    if (writes.get(target) === write) writes.delete(target);
  }
}

export async function readContextSnapshot(file: string, sessionId: string, revision: string | null, model: string | null): Promise<ContextDetails | null> {
  try {
    await globalThis.__piContextSnapshotWrites?.get(`${file}.context-usage.json`);
    const snapshot = JSON.parse(await readFile(`${file}.context-usage.json`, "utf8"));
    const details = snapshot?.details;
    if (snapshot?.version !== 1 || snapshot.revision !== revision || details?.sessionId !== sessionId || details.model !== model) return null;
    if (!count(details.usage?.tokens) || !count(details.usage.contextWindow) || (details.usage.percent !== null && !count(details.usage.percent))) return null;
    if (!Array.isArray(details.breakdown) || details.breakdown.length > categories.size || !details.breakdown.every((part: { id?: unknown; tokens?: unknown } | null) => part && typeof part.id === "string" && categories.has(part.id) && (part.tokens === null || count(part.tokens)))) return null;
    if (details.reserveTokens !== null && !count(details.reserveTokens)) return null;
    return { ...details, source: "snapshot", usageEstimated: true, usage: { ...details.usage, estimated: true } };
  } catch {
    return null;
  }
}
