import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isEditToolName, isWriteToolName } from "./tool-names";
import { parseUnifiedPatch } from "./patch";

export interface ChangeLineStats {
  additions: number;
  deletions: number;
}

export interface FileChangeRecord {
  toolCallId: string;
  /** The recorded patch or legacy diff, never the current workspace diff. */
  patch: string | null;
  stats: ChangeLineStats | null;
}

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
  /** Optional so old callers and path-only historical records remain usable. */
  changes?: FileChangeRecord[];
}

export interface TurnChangesRequest {
  files: WrittenFile[];
  cwd?: string;
  sessionId?: string;
  selectedFilePath?: string;
}

export type OpenTurnChanges = (request: TurnChangesRequest) => void;

export function getRecordedPatchStats(patch: string | null): ChangeLineStats | null {
  const parsed = patch && /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(patch) ? parseUnifiedPatch(patch) : null;
  // A writing tool identifies one file. A multi-file or non-standard patch
  // cannot reliably supply that file's line counts, but remains viewable.
  return parsed?.length === 1 ? parsed[0].rows.reduce<ChangeLineStats>((total, row) => {
    if (row.type === "line") {
      if (row.left.type === "removed") total.deletions++;
      if (row.right.type === "added") total.additions++;
    }
    return total;
  }, { additions: 0, deletions: 0 }) : null;
}

function readChangeRecord(toolCallId: string, details: unknown): FileChangeRecord {
  const data = details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown> : {};
  const patch = typeof data.patch === "string" && data.patch.trim() ? data.patch
    : typeof data.diff === "string" && data.diff.trim() ? data.diff : null;
  let stats = getRecordedPatchStats(patch);
  const writeDiff = data.eurekaWriteDiff as Record<string, unknown> | undefined;
  // A no-op write (including creation of an empty file) has no patch hunks.
  if (!stats && patch && !/^@@ /m.test(patch) && writeDiff?.version === 1
    && writeDiff.additions === 0 && writeDiff.deletions === 0) {
    stats = { additions: 0, deletions: 0 };
  }
  return { toolCallId, patch, stats };
}

/** Counts are complete only when every successful operation has a known diff. */
export function getWrittenFileStats(file: WrittenFile): ChangeLineStats | null {
  if (!file.changes?.length || file.changes.some((change) => change.stats === null)) return null;
  return file.changes.reduce((total, change) => ({
    additions: total.additions + change.stats!.additions,
    deletions: total.deletions + change.stats!.deletions,
  }), { additions: 0, deletions: 0 });
}

export function summarizeWrittenFiles(files: WrittenFile[]) {
  let knownFiles = 0;
  const totals = files.reduce((total, file) => {
    const stats = getWrittenFileStats(file);
    if (stats) {
      knownFiles++;
      total.additions += stats.additions;
      total.deletions += stats.deletions;
    }
    return total;
  }, { additions: 0, deletions: 0 });
  return { ...totals, knownFiles, partial: knownFiles < files.length };
}

/** Extraction creates fresh arrays; compare their records without hiding updates. */
export function haveSameWrittenFiles(left?: WrittenFile[], right?: WrittenFile[]): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((file, index) => {
    const other = right[index];
    if (file.filePath !== other.filePath) return false;
    const changes = file.changes ?? [];
    const otherChanges = other.changes ?? [];
    return changes.length === otherChanges.length && changes.every((change, changeIndex) => {
      const next = otherChanges[changeIndex];
      return change.toolCallId === next.toolCallId && change.patch === next.patch
        && change.stats?.additions === next.stats?.additions && change.stats?.deletions === next.stats?.deletions;
    });
  });
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Collect the distinct files a single assistant turn actually wrote.
 *
 * Every entry is derived from a `write`/`edit` tool call whose result arrived
 * and did not error — never from the reply text. A path the assistant merely
 * mentions in prose is not evidence that any file was touched, so it is not a
 * source here; the tool call is the record of what happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const seen = new Map<string, WrittenFile>();
  const seenCalls = new Set<string>();
  const writtenFiles: WrittenFile[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName)) continue;

    // No result yet (still streaming) or the call failed — nothing was written.
    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;
    if (seenCalls.has(block.toolCallId)) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    // Tool arguments are filesystem paths, not hrefs: preserve characters such
    // as #, ?, and :digits that have special meaning in links and source refs.
    const filePath = resolveLocalFilePath(rawPath, cwd);
    if (!filePath) continue;

    seenCalls.add(block.toolCallId);
    const key = /^(?:[a-z]:\/|\/\/)/i.test(filePath) ? filePath.toLowerCase() : filePath;
    let file = seen.get(key);
    if (!file) {
      file = { filePath, changes: [] };
      seen.set(key, file);
      writtenFiles.push(file);
    }
    file.changes!.push(readChangeRecord(block.toolCallId, result.details));
  }

  return writtenFiles;
}
