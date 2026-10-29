import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitDiffMode,
  GitFileStatus,
  GitLineStats,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  parseGitNumstat,
  type GitPorcelainEntry,
} from "./git-status";
import { toNativePath } from "./paths";
import { isSafeGitPath } from "./git-file-state";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--literal-pathspecs", "-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()) || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
): Promise<{ files: Map<string, GitLineStats>; unborn: boolean }> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--numstat",
      "-z",
      "HEAD",
      "--",
      pathspec,
    ]);
    return { files: parseGitNumstat(output), unborn: false };
  } catch {
    let unborn = false;
    try { await git(repositoryRoot, ["rev-parse", "--verify", "HEAD"]); } catch { unborn = true; }
    return { files: new Map(), unborn };
  }
}

function countWorkingTextLines(filePath: string): number | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return null;
    const content = fs.readFileSync(filePath);
    if (hasNullByte(content)) return null;
    if (content.length === 0) return 0;
    const text = content.toString("utf8");
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? 0 : null;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    };
  }

  const [entries, trackedLineStats] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readTrackedLineStats(repositoryRoot, cwd),
  ]);
  const files: GitFileStatus[] = [];
  for (const entry of entries) {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) continue;
    const classified = classifyGitStatus(entry);
    let lineStats: GitLineStats = trackedLineStats.files.get(entry.path) ?? { additions: 0, deletions: 0 };
    const originalStats = (entry.indexStatus === "R" || entry.worktreeStatus === "R") && entry.originalPath && entry.originalPath !== entry.path
      ? trackedLineStats.files.get(entry.originalPath) : undefined;
    if (originalStats) {
      // A staged rename can become a delete/add pair in the total working diff.
      lineStats = {
        additions: lineStats.additions === null || originalStats.additions === null ? null : lineStats.additions + originalStats.additions,
        deletions: lineStats.deletions === null || originalStats.deletions === null ? null : lineStats.deletions + originalStats.deletions,
      };
    }
    if (classified.status === "untracked" || trackedLineStats.unborn) {
      lineStats = { additions: await isSafeGitPath(repositoryRoot, entry.path) ? countWorkingTextLines(filePath) : null, deletions: 0 };
    }
    files.push({
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      ...lineStats,
    });
  }

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
  };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
  mode?: GitDiffMode,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      ...(mode === "staged" ? ["--cached"] : mode === "unstaged" ? [] : ["HEAD"]),
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string, mode?: GitDiffMode): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  if (mode) {
    const selectedStatus = mode === "staged" ? entry.indexStatus : entry.worktreeStatus;
    if (selectedStatus === " " || (mode === "staged" && selectedStatus === "?")) return { supported: false };
    if (selectedStatus !== "?") {
      const scopedEntry = { ...entry, indexStatus: mode === "staged" ? selectedStatus : " ",
        worktreeStatus: mode === "unstaged" ? selectedStatus : " " };
      const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, mode);
      if (!patch?.trim()) return { supported: false };
      return { supported: true, status: classifyGitStatus(scopedEntry).status, patch };
    }
  }

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") {
    const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (!patch?.includes("\n@@ ")) return { supported: false };
    return { supported: true, status, patch };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}
