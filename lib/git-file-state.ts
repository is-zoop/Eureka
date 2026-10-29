import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export interface GitFileSnapshot {
  version: string;
  contentHash: string | null;
  kind: "file" | "symlink" | "directory" | "missing" | "unsafe";
}

export class GitFileStateChangedError extends Error {
  constructor() { super("File changed while reading Git status"); }
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fileDigest = (value: Buffer) => createHash("sha256").update("file\0").update(value).digest("hex");

/** Reject directory symlinks and Git metadata, including for deleted files. */
export async function isSafeGitPath(root: string, relativePath: string): Promise<boolean> {
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) return false;
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return false;
  // Windows aliases and alternate streams must not bypass the component checks.
  if (process.platform === "win32" && parts.some((part) => /[\\:]/.test(part) || /[. ]$/.test(part))) return false;
  const resolved = path.relative(root, path.resolve(root, relativePath));
  if (!resolved || resolved === ".." || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) return false;
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    try {
      const stat = await lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
  return true;
}

export async function getGitFileSnapshot(root: string, relativePath: string): Promise<GitFileSnapshot> {
  if (!await isSafeGitPath(root, relativePath)) return { kind: "unsafe", version: "unsafe", contentHash: null };
  const filePath = path.resolve(root, relativePath);
  let stat;
  try { stat = await lstat(filePath, { bigint: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { kind: "missing", version: "missing", contentHash: digest("missing") };
  }
  const identity = [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
  let kind: GitFileSnapshot["kind"] = "directory";
  let contentHash: string | null = null;
  if (stat.isSymbolicLink()) {
    kind = "symlink";
    contentHash = digest(`symlink\0${await readlink(filePath)}`);
  } else if (stat.isFile()) {
    kind = "file";
    const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await file.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new GitFileStateChangedError();
      const hash = createHash("sha256").update("file\0");
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
      const after = await file.stat({ bigint: true });
      if (after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs || after.size !== stat.size) {
        throw new GitFileStateChangedError();
      }
      contentHash = hash.digest("hex");
    } finally { await file.close(); }
  } else if (!stat.isDirectory()) {
    kind = "unsafe";
  }
  return { kind, contentHash, version: digest(JSON.stringify([kind, identity, contentHash])) };
}

/** Append one exact, repository-root-relative rule without rewriting existing bytes. */
export async function appendGitIgnore(root: string, relativePath: string, expected: GitFileSnapshot): Promise<void> {
  if (relativePath === ".gitignore" || /[\r\n]/.test(relativePath) || !await isSafeGitPath(root, relativePath)) {
    throw new Error("Invalid ignore path");
  }
  if (expected.kind !== "file" && expected.kind !== "missing") throw new Error(".gitignore must be a regular file");
  if ((await getGitFileSnapshot(root, ".gitignore")).version !== expected.version) throw new Error("Git ignore file changed");
  const ignorePath = path.join(root, ".gitignore");
  const file = await open(ignorePath, expected.kind === "missing"
    ? constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)
    : constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat({ bigint: true });
    const current = await lstat(ignorePath, { bigint: true });
    if (!opened.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error("Git ignore file changed");
    }
    const existing = await file.readFile();
    if (expected.kind === "file" && fileDigest(existing) !== expected.contentHash) throw new Error("Git ignore file changed");
    const text = existing.toString("utf8");
    const rule = "/" + relativePath.replace(/[\\*?\[\]#! \t]/g, "\\$&");
    if (text.replace(/^\uFEFF/, "").split(/\r?\n/).includes(rule)) return;
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const prefix = existing.length && !text.endsWith("\n") ? newline : "";
    const addition = Buffer.from(`${prefix}${rule}${newline}`);
    const beforeWrite = await file.stat({ bigint: true });
    if (beforeWrite.size !== opened.size || beforeWrite.mtimeNs !== opened.mtimeNs || beforeWrite.ctimeNs !== opened.ctimeNs) {
      throw new Error("Git ignore file changed");
    }
    for (let offset = 0; offset < addition.length;) {
      const { bytesWritten } = await file.write(addition, offset, addition.length - offset, existing.length + offset);
      if (!bytesWritten) throw new Error("Could not append Git ignore rule");
      offset += bytesWritten;
    }
  } finally { await file.close(); }
}
