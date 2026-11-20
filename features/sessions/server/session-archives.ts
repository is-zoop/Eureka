import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, type SessionEntry } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "../../../lib/atomic-file";
import type { SessionArchive } from "../../../lib/types";

function archivePath(): string {
  return join(getAgentDir(), "eureka-session-archives.json");
}

export function readSessionArchives(path = archivePath()): Map<string, SessionArchive> {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, SessionArchive>));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

export async function updateSessionArchive(
  id: string,
  update: (current: SessionArchive | null) => SessionArchive | null,
  path = archivePath(),
): Promise<SessionArchive | null> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false,
    retries: { retries: 5, minTimeout: 20, maxTimeout: 200 },
  });
  try {
    const entries = readSessionArchives(path);
    const current = entries.get(id) ?? null;
    const next = update(current);
    if (next === current) return next;
    if (next) entries.set(id, next);
    else entries.delete(id);
    writePrivateFileAtomicSync(path, JSON.stringify(Object.fromEntries(entries)));
    return next;
  } finally {
    await release();
  }
}

export function summarizeArchivedBranch(branch: readonly SessionEntry[]): Omit<SessionArchive, "archivedAt"> {
  let turnCount = 0;
  let lastMessageMs = -Infinity;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message.role === "user") turnCount++;
    else if (message.role !== "assistant" || !message.content.some((part) => part.type === "text" && part.text.trim())) continue;
    const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : Date.parse(entry.timestamp);
    if (Number.isFinite(timestamp)) lastMessageMs = Math.max(lastMessageMs, timestamp);
  }
  return { turnCount, lastConversationAt: Number.isFinite(lastMessageMs) ? new Date(lastMessageMs).toISOString() : null };
}
