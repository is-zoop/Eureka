import { readFile, realpath, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { WebFileEntry, WebFilePreview } from "@pi-web/protocol";

const TEXT_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export class WorkspaceFiles {
  private readonly ignored: Promise<Ignore>;
  constructor(private readonly workspace: string) { this.ignored = this.loadIgnore(); }

  async list(relative?: string): Promise<WebFileEntry[]> {
    const absolute = await this.resolve(relative);
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new WorkspaceFileError("not_directory", "The requested path is not a directory.");
    const rules = await this.ignored;
    const entries: WebFileEntry[] = [];
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (rules.ignores(childRelative) || rules.ignores(`${childRelative}/`)) continue;
      const child = await this.resolve(childRelative).catch(() => undefined);
      if (!child) continue;
      const childInfo = await stat(child).catch(() => undefined);
      if (!childInfo || (!childInfo.isFile() && !childInfo.isDirectory())) continue;
      entries.push({ path: childRelative, name: entry.name, kind: childInfo.isDirectory() ? "directory" : "file", ...(childInfo.isFile() ? { size: childInfo.size } : {}), modifiedAt: childInfo.mtimeMs });
    }
    return entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
  }

  async preview(relative: string): Promise<WebFilePreview> {
    const absolute = await this.resolve(relative);
    const info = await stat(absolute);
    if (!info.isFile()) throw new WorkspaceFileError("not_file", "The requested path is not a file.");
    const mimeType = IMAGE_TYPES[path.extname(relative).toLowerCase()];
    if (mimeType) {
      if (info.size > IMAGE_LIMIT) return { kind: "unavailable", path: relative, reason: "too_large" };
      return { kind: "image", path: relative, mimeType, data: (await readFile(absolute)).toString("base64") };
    }
    if (info.size > TEXT_LIMIT) return { kind: "unavailable", path: relative, reason: "too_large" };
    const buffer = await readFile(absolute);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (content.includes("\0")) return { kind: "unavailable", path: relative, reason: "binary" };
      return { kind: "text", path: relative, content, truncated: false };
    } catch { return { kind: "unavailable", path: relative, reason: "binary" }; }
  }

  private async loadIgnore(): Promise<Ignore> {
    const rules = ignore().add([".git", ".git/**", "node_modules", "node_modules/**"]);
    try { rules.add(await readFile(path.join(this.workspace, ".gitignore"), "utf8")); } catch { /* .gitignore is optional */ }
    return rules;
  }
  private async resolve(relative?: string): Promise<string> {
    if (relative && (!isSafeRelativePath(relative))) throw new WorkspaceFileError("invalid_path", "The requested path is invalid.");
    const candidate = relative ? path.join(this.workspace, ...relative.split("/")) : this.workspace;
    const resolved = await realpath(candidate).catch(() => { throw new WorkspaceFileError("file_not_found", "The requested file was not found."); });
    if (!isWithin(this.workspace, resolved)) throw new WorkspaceFileError("path_outside_workspace", "The requested path is outside the workspace.");
    return resolved;
  }
}
export class WorkspaceFileError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function isSafeRelativePath(value: string) { return !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."); }
function isWithin(root: string, candidate: string) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
