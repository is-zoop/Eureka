export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
  additions?: number | null;
  deletions?: number | null;
}

export interface GitLineStats {
  additions: number | null;
  deletions: number | null;
}

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  additions: number;
  deletions: number;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

export type GitDiffMode = "staged" | "unstaged";

export interface GitWorkspaceFile extends GitFileStatus {
  relativePath: string;
  originalPath?: string;
  contentHash: string | null;
  canStage: boolean;
  canDiscard: boolean;
  canIgnore: boolean;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitWorkspace {
  repositoryRoot: string;
  branch: string | null;
  head: string | null;
  revision: string;
  files: GitWorkspaceFile[];
  commits: GitCommit[];
  upstream: string | null;
  remote: string | null;
  remoteBranch: string | null;
  remotes: string[];
  ahead: number | null;
  behind: number | null;
  operationInProgress: boolean;
}

export interface GitMutation {
  action: "stage" | "unstage" | "discard" | "ignore" | "commit" | "push";
  revision: string;
  paths?: string[];
  message?: string;
  remote?: string;
  stageAllIfEmpty?: boolean;
  expectedContentHash?: string;
}
