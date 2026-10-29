import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { classifyGitStatus, parseGitPorcelainV1 } from "./git-status";
import { toNativePath } from "./paths";
import type { GitCommit, GitMutation, GitWorkspace, GitWorkspaceFile } from "./git-types";
import { appendGitIgnore, getGitFileSnapshot, GitFileStateChangedError, isSafeGitPath } from "./git-file-state";

const execFileAsync = promisify(execFile);

export class GitOperationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export async function runGit(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["--literal-pathspecs", "-C", cwd, ...args], {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string; killed?: boolean };
    throw new GitOperationError(
      failure.killed ? "timeout" : "gitFailed",
      failure.killed ? "Git operation timed out. Refresh the status before retrying."
        : (failure.stderr?.trim() || failure.stdout?.trim() || failure.message)
          .replace(/(https?:\/\/)[^/\s@]+@/g, "$1***@").slice(0, 6000),
    );
  }
}

async function optionalGit(cwd: string, args: string[]): Promise<string | null> {
  try { return (await runGit(cwd, args)).trim() || null; } catch { return null; }
}

export async function getGitRepositoryRoot(cwd: string): Promise<string> {
  try {
    const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    return realpathSync(toNativePath(root.trim()));
  } catch (error) {
    if (error instanceof Error && /not a git repository/i.test(error.message)) {
      throw new GitOperationError("noRepository", "This folder is not a Git repository.");
    }
    throw error;
  }
}

export async function getGitWorkspace(repositoryRoot: string, includeHistory = true): Promise<GitWorkspace> {
  const [status, branch, head, index, remoteOutput, gitDir] = await Promise.all([
    runGit(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    optionalGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    optionalGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
    runGit(repositoryRoot, ["diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "-z"]),
    runGit(repositoryRoot, ["remote"]),
    runGit(repositoryRoot, ["rev-parse", "--absolute-git-dir"]),
  ]);
  const remotes = remoteOutput.trim().split(/\r?\n/).filter(Boolean);
  const tracking = branch ? await runGit(repositoryRoot, [
    "for-each-ref", "--format=%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)",
    `refs/heads/${branch}`,
  ]) : "";
  const [upstream, remote, remoteRef] = tracking.trim().split("\0");
  const counts = upstream && head
    ? await optionalGit(repositoryRoot, ["rev-list", "--left-right", "--count", `HEAD...@{upstream}`])
    : null;
  // Missing/broken tracking refs are unknown, never a claim that the branch is in sync.
  const countMatch = counts?.match(/^(\d+)\s+(\d+)$/);
  const ahead = countMatch ? Number(countMatch[1]) : null;
  const behind = countMatch ? Number(countMatch[2]) : null;
  const absoluteGitDir = toNativePath(gitDir.trim());
  const operationInProgress = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]
    .some((name) => existsSync(path.join(absoluteGitDir, name)));
  const commits: GitCommit[] = [];
  if (includeHistory && head) {
    const fields = (await runGit(repositoryRoot, [
      "log", "--no-show-signature", "--no-decorate", "--max-count=50", "-z",
      "--format=%H%x00%s%x00%an%x00%aI", head, "--",
    ])).split("\0");
    for (let i = 0; i + 3 < fields.length; i += 4) {
      commits.push({ hash: fields[i], subject: fields[i + 1], author: fields[i + 2], date: fields[i + 3] });
    }
  }
  const ignoreSnapshot = await getGitFileSnapshot(repositoryRoot, ".gitignore");
  const entries = parseGitPorcelainV1(status);
  const files: GitWorkspaceFile[] = [];
  const versions: string[] = [];
  // Bound file reads so large change lists do not exhaust file descriptors.
  for (let start = 0; start < entries.length; start += 8) {
    const batch = await Promise.all(entries.slice(start, start + 8).map(async (entry) => {
      const snapshot = await getGitFileSnapshot(repositoryRoot, entry.path);
      const classified = classifyGitStatus(entry);
      const safe = snapshot.kind !== "unsafe";
      const regular = snapshot.kind === "file" || snapshot.kind === "symlink" || snapshot.kind === "missing";
      return { version: snapshot.version, file: {
        filePath: path.resolve(repositoryRoot, entry.path), relativePath: entry.path, originalPath: entry.originalPath,
        indexStatus: entry.indexStatus, worktreeStatus: entry.worktreeStatus, ...classified,
        contentHash: snapshot.contentHash,
        canStage: safe && classified.status !== "conflict",
        canDiscard: safe && regular && classified.status !== "conflict" && classified.status !== "untracked"
          && entry.worktreeStatus !== " ",
        canIgnore: safe && regular && classified.status === "untracked"
          && (process.platform === "win32" ? entry.path.toLowerCase() : entry.path) !== ".gitignore" && !/[\r\n]/.test(entry.path)
          && (ignoreSnapshot.kind === "file" || ignoreSnapshot.kind === "missing"),
      } };
    }));
    for (const item of batch) { files.push(item.file); versions.push(item.version); }
  }
  return {
    repositoryRoot, branch, head,
    revision: createHash("sha256").update(JSON.stringify([branch, head, index, tracking, remotes, operationInProgress, status, versions, ignoreSnapshot.version])).digest("hex"),
    files,
    upstream: upstream || null,
    remote: remote || null,
    remoteBranch: remoteRef?.replace(/^refs\/heads\//, "") || null,
    commits, remotes, ahead, behind, operationInProgress,
  };
}

declare global {
  var __eurekaGitMutations: Set<string> | undefined;
}

// Keep the guard across Next.js hot reloads. Git still owns its on-disk locks.
export async function mutateGit(repositoryRoot: string, input: GitMutation): Promise<{ commit?: string }> {
  const locks = globalThis.__eurekaGitMutations ??= new Set();
  const key = process.platform === "win32" ? repositoryRoot.toLowerCase() : repositoryRoot;
  if (locks.has(key)) throw new GitOperationError("busy", "Another Git operation is running.", 409);
  locks.add(key);
  try {
    const state = await getGitWorkspace(repositoryRoot, false);
    if (!input.revision || input.revision !== state.revision) {
      throw new GitOperationError("stale", "Git status changed. Refresh and try again.", 409);
    }
    if (input.action === "discard" || input.action === "ignore") {
      const selected = Array.isArray(input.paths) && input.paths.length === 1 ? input.paths[0] : null;
      const file = state.files.find((candidate) => candidate.relativePath === selected);
      if (!file) throw new GitOperationError("stale", "Git status changed. Refresh and try again.", 409);
      if (state.operationInProgress || state.files.some((candidate) => candidate.status === "conflict")) {
        throw new GitOperationError("inProgress", "Finish the current merge or rebase first.");
      }
      if (input.action === "discard") {
        if (!file.canDiscard) throw new GitOperationError("cannotDiscard", "Only tracked, unstaged file changes can be discarded.");
        if (!input.expectedContentHash || input.expectedContentHash !== file.contentHash
          || (await getGitFileSnapshot(repositoryRoot, file.relativePath)).contentHash !== input.expectedContentHash) {
          throw new GitOperationError("stale", "File contents changed. Refresh and try again.", 409);
        }
        await runGit(repositoryRoot, ["restore", "--worktree", "--", file.relativePath]);
      } else {
        if (!file.canIgnore) throw new GitOperationError("cannotIgnore", "Only untracked files can be added to .gitignore.");
        const expected = await getGitFileSnapshot(repositoryRoot, ".gitignore");
        if ((await getGitWorkspace(repositoryRoot, false)).revision !== input.revision) {
          throw new GitOperationError("stale", "Git status changed. Refresh and try again.", 409);
        }
        try { await appendGitIgnore(repositoryRoot, file.relativePath, expected); } catch (error) {
          if (error instanceof Error && /changed|EEXIST/.test(error.message)) {
            throw new GitOperationError("stale", "Git status changed. Refresh and try again.", 409);
          }
          throw error;
        }
      }
      return {};
    }
    if (input.action === "stage" || input.action === "unstage") {
      if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 2000) {
        throw new GitOperationError("invalidPaths", "Select files to continue.");
      }
      const paths = new Set<string>();
      for (const selected of input.paths) {
        const file = state.files.find((candidate) => candidate.relativePath === selected);
        // Accept only exact, Git-reported paths; directories and pathspec magic are never expanded.
        if (!file || !file.canStage || file.relativePath === ".." || file.relativePath.startsWith("../")
          || path.isAbsolute(file.relativePath)) {
          throw new GitOperationError("invalidPaths", "The selected file is unavailable.");
        }
        paths.add(file.relativePath);
        if (file.originalPath) {
          if (!await isSafeGitPath(repositoryRoot, file.originalPath)) throw new GitOperationError("invalidPaths", "Invalid rename path.");
          paths.add(file.originalPath);
        }
      }
      const args = input.action === "stage" ? ["add", "--", ...paths]
        : state.head ? ["restore", "--staged", "--", ...paths]
          : ["rm", "--cached", "--force", "--", ...paths];
      await runGit(repositoryRoot, args);
      return {};
    }
    if (!state.branch) throw new GitOperationError("detached", "Switch to a branch first.");
    if (state.operationInProgress) throw new GitOperationError("inProgress", "Finish the current merge or rebase first.");
    if (state.files.some((file) => file.status === "conflict")) {
      throw new GitOperationError("conflicts", "Resolve the file conflicts first.");
    }
    if (input.action === "commit") {
      const message = typeof input.message === "string" ? input.message.trim() : "";
      if (!message || message.length > 20_000 || message.includes("\0")) {
        throw new GitOperationError("invalidMessage", "Enter a commit message.");
      }
      const staged = state.files.some((file) => file.indexStatus !== " " && file.indexStatus !== "?");
      if (!staged) {
        if (input.stageAllIfEmpty !== true) throw new GitOperationError("nothingStaged", "Select changes to commit first.");
        if (!state.files.length) throw new GitOperationError("nothingStaged", "No changes to commit.");
        if (state.files.some((file) => !file.canStage)) throw new GitOperationError("invalidPaths", "A changed path is unavailable.");
        // Verify the same worktree snapshot immediately before staging everything.
        if ((await getGitWorkspace(repositoryRoot, false)).revision !== input.revision) {
          throw new GitOperationError("stale", "Git status changed. Refresh and try again.", 409);
        }
        await runGit(repositoryRoot, ["add", "--all", "--", "."]);
      }
      await runGit(repositoryRoot, ["commit", "-m", message], 120_000);
      return { commit: (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).trim() };
    }
    if (input.action === "push") {
      if (!state.head) throw new GitOperationError("noCommits", "Create a commit first.");
      const remote = state.remote ?? input.remote;
      if (!remote || !state.remotes.includes(remote) || remote.startsWith("-")) {
        throw new GitOperationError("noRemote", "Select a configured remote first.");
      }
      const target = state.remoteBranch ?? state.branch;
      await runGit(repositoryRoot, [
        "push", "--porcelain", ...(!state.upstream ? ["--set-upstream"] : []),
        "--", remote, `refs/heads/${state.branch}:refs/heads/${target}`,
      ], 120_000);
      return {};
    }
    throw new GitOperationError("invalidAction", "Unsupported Git action.");
  } catch (error) {
    if (error instanceof GitFileStateChangedError || ["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code ?? "")) {
      throw new GitOperationError("stale", "File contents changed. Refresh and try again.", 409);
    }
    throw error;
  } finally {
    locks.delete(key);
  }
}
