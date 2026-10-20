import { open, mkdir, writeFile } from "node:fs/promises";
import {
  createWriteToolDefinition,
  generateUnifiedPatch,
  type InlineExtension,
  type ToolDefinition,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import { getRecordedPatchStats } from "./turn-written-files";

export const WRITE_DIFF_MAX_BYTES = TEXT_PREVIEW_MAX_BYTES;
// Bound synchronous diff work as well as the amount retained in the session.
export const WRITE_DIFF_MAX_LINES = 4_000;

interface WriteDiffDetails {
  patch: string;
  eurekaWriteDiff: { version: 1; additions: number; deletions: number };
}

interface WriteDiffOptions {
  operations?: WriteOperations;
  readSnapshot?: (filePath: string) => Promise<string | null>;
  generatePatch?: typeof generateUnifiedPatch;
}

function canTrack(content: string): boolean {
  return !content.includes("\0") && Buffer.byteLength(content, "utf8") <= WRITE_DIFF_MAX_BYTES;
}

/** null means unknown, whereas an absent target has a known empty baseline. */
async function readSnapshot(filePath: string): Promise<string | null> {
  try {
    const handle = await open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > WRITE_DIFF_MAX_BYTES) return null;
      // Read at most limit + 1 even if another process grows the file after stat.
      const buffer = Buffer.alloc(WRITE_DIFF_MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > WRITE_DIFF_MAX_BYTES || buffer.subarray(0, length).includes(0)) return null;
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    return null;
  }
}

function createDetails(filePath: string, before: string, after: string, generatePatch: typeof generateUnifiedPatch): WriteDiffDetails | undefined {
  if (!canTrack(before) || !canTrack(after)) return;
  if (before.split("\n").length + after.split("\n").length > WRITE_DIFF_MAX_LINES) return;
  const patch = generatePatch(filePath, before, after);
  if (Buffer.byteLength(patch, "utf8") > WRITE_DIFF_MAX_BYTES) return;
  const stats = before === after ? { additions: 0, deletions: 0 } : getRecordedPatchStats(patch);
  if (!stats) return;
  return { patch, eurekaWriteDiff: { version: 1, ...stats } };
}

/** Preserve the SDK schema, prompts, abort behavior, filesystem queue and errors. */
export function createWriteDiffTool(cwd: string, options: WriteDiffOptions = {}): ToolDefinition<ReturnType<typeof createWriteToolDefinition>["parameters"], WriteDiffDetails | undefined> {
  const { renderResult, ...definition } = createWriteToolDefinition(cwd);
  return {
    ...definition,
    ...(renderResult ? {
      renderResult: (result, renderOptions, theme, context) => renderResult({ ...result, details: undefined }, renderOptions, theme, context),
    } : {}),
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      let details: WriteDiffDetails | undefined;
      const native = createWriteToolDefinition(cwd, {
        operations: {
          mkdir: options.operations?.mkdir ?? (async (dir) => { await mkdir(dir, { recursive: true }); }),
          writeFile: async (filePath, content) => {
            let before: string | null = null;
            if (canTrack(content)) {
              try { before = await (options.readSnapshot ?? readSnapshot)(filePath); }
              catch { /* Snapshot failure must never block an otherwise valid write. */ }
            }
            if (signal?.aborted) throw new Error("Operation aborted");
            // The SDK calls this operation INSIDE its per-file mutation queue.
            // Do not wrap native.execute in another queue: that would deadlock.
            if (options.operations) await options.operations.writeFile(filePath, content);
            else await writeFile(filePath, content, "utf8");
            if (before !== null) {
              try {
                // Node writes UTF-8 replacement characters for lone surrogates.
                const writtenContent = Buffer.from(content, "utf8").toString("utf8");
                details = createDetails(params.path, before, writtenContent, options.generatePatch ?? generateUnifiedPatch);
              } catch { /* A completed write stays successful if diff generation fails. */ }
            }
          },
        },
      });
      const result = await native.execute(toolCallId, params, signal, onUpdate, context);
      return details ? { ...result, details } : result;
    },
  };
}

export const EUREKA_WRITE_DIFF_EXTENSION: InlineExtension = {
  name: "eureka-write-diff",
  hidden: true,
  factory: (pi) => {
    pi.on("session_start", (_event, context) => {
      // Runtime metadata is available here, including third-party overrides.
      // Replacing an existing name also preserves its active/inactive state.
      const write = pi.getAllTools().find((tool) => tool.name === "write");
      if (write?.sourceInfo.source === "builtin") pi.registerTool(createWriteDiffTool(context.cwd));
    });
  },
};
