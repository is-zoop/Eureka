import path from "node:path";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isPathWithinRoots } from "./path-security";
import { isWindowsAbsolutePath, samePath } from "./paths";
import { readAutomationMode, type AutomationTaskRef } from "./automation-mode";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROOTS = 32;
const ignoredDirectories = new Set([".git", ".pi", ".codex", ".ssh", ".aws", ".next", ".venv", "venv", "node_modules", "__pycache__", "target", "cookies", "credentials", "profiles", "browser-data", "user-data"]);
const sourceExtensions = new Set(".py .js .jsx .ts .tsx .mjs .cjs .rs .go .java .kt .cs .c .cpp .h .hpp .swift .rb .php .vue .svelte .html .css .scss .sass .less .sql .sh .ps1 .bat .cmd .md .txt .json .toml .yaml .yml .ini .cfg .conf .xml".split(" "));
const sourceNames = new Set(["dockerfile", "makefile", "cmakelists.txt", ".gitignore"]);

function sourcePath(value: string): string | null {
  if (!value || value.length > 4096 || /[\x00-\x1f<>|?*]/.test(value) || /^(?:\\\\|\/\/)/.test(value) || value.split(/[\\/]/).includes("..")) return null;
  const resolver = isWindowsAbsolutePath(value) ? path.win32 : path.posix;
  if (!resolver.isAbsolute(value) || value.slice(isWindowsAbsolutePath(value) ? 2 : 0).includes(":")) return null;
  const resolved = resolver.normalize(value);
  return resolved === resolver.parse(resolved).root ? null : resolved.replace(/[\\/]+$/, "");
}

/** Called with the original user submission, never assistant/tool/file content. */
export function sourcePathsFromUserText(text: string): string[] {
  text = text.replace(/<(file|attachment|skill|untrusted_text)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const paths: string[] = [];
  const add = (value: string) => { const normalized = sourcePath(value); if (normalized && !paths.some(old => samePath(old, normalized))) paths.push(normalized); };
  const unquoted = text.replace(/"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`/g, (full, double, single, code) => {
    const value = double ?? single ?? code;
    if (!sourcePath(value)) return full;
    add(value); return " ".repeat(full.length);
  });
  for (const match of unquoted.matchAll(/(?<![\w.:/\\])(?:[A-Za-z]:[\\/]|\/(?!\/))[^\s"'`<>，。；！？、（）()【】\[\]{};]+/g)) add(match[0].replace(/[,.]+$/, ""));
  return paths.slice(0, MAX_ROOTS);
}

export function mergeSourcePaths(previous: readonly string[], ...userTexts: string[]): string[] {
  const paths: string[] = [];
  for (const value of [...previous, ...userTexts.flatMap(sourcePathsFromUserText)]) {
    const normalized = sourcePath(value);
    if (normalized && !paths.some(old => samePath(old, normalized))) paths.push(normalized);
  }
  return paths.slice(0, MAX_ROOTS);
}

/** One-time migration for old task records, using only this task's user entries. */
export function legacySourcePaths(entries: readonly { type: string; customType?: string; data?: unknown; message?: unknown }[], task: AutomationTaskRef): string[] {
  let active = false;
  const texts: string[] = [];
  for (const entry of entries) {
    const mode = readAutomationMode([entry]);
    // A retired cloud login still refers to the same local task. UUID and
    // namespace exclude unrelated tasks; model/tool content never grants paths.
    if (entry.type === "custom" && entry.customType === "eureka_automation_mode") active = Boolean(mode?.status === "active" && mode.task.id === task.id && mode.task.ownerKey === task.ownerKey);
    if (!active || entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
    const message = entry.message as { role?: unknown; content?: unknown };
    if (message.role !== "user") continue;
    if (typeof message.content === "string") texts.push(message.content);
    else if (Array.isArray(message.content)) texts.push(message.content.filter(block => block?.type === "text" && typeof block.text === "string").map(block => block.text).join("\n"));
  }
  return mergeSourcePaths([], ...texts);
}

function readableName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/^\.env(?:\.|$)/.test(lower) || /^(?:cookies?|tokens?|credentials?|passwords?|secrets?|auth|sessions?)(?:[._-]|$)/.test(lower)) return false;
  return sourceNames.has(lower) || sourceExtensions.has(path.extname(lower));
}
function redactText(text: string) {
  let redacted = false;
  const content = text.replace(/((?<![\w.-])["']?[\w.-]{1,160}["']?\s*[:=]\s*)(["'])((?:\\.|(?!\2)[^\\\r\n])*)\2/g, (full, key, quote) => {
    if (!/password|passwd|secret|token|api[_-]?key|authorization|cookie/i.test(key)) return full;
    redacted = true; return `${key}${quote}[credential]${quote}`;
  });
  return { content, redacted };
}
function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /password|passwd|secret|token|api[_-]?key|authorization|cookie/i.test(key) && typeof entry === "string" ? "[credential]" : redactJson(entry)]));
  return value;
}

export interface SourceReadInput { path: string; method: "list" | "readText" | "readJson"; offset?: number; limit?: number }
/** Private authoring context only: no runtime file grant, code execution or global file-root changes. */
export class AutomationSourceReader {
  constructor(private options: { roots: readonly string[]; privateRoots: readonly string[]; check: () => void }) {}

  private async resolve(raw: string) {
    this.options.check();
    const normalized = sourcePath(raw);
    if (!normalized || !path.isAbsolute(normalized) || process.platform === "win32" && !isWindowsAbsolutePath(normalized)) throw new Error("请使用本机完整的源码文件或目录路径。");
    const root = this.options.roots.map(sourcePath).filter((v): v is string => Boolean(v)).find(root => isPathWithinRoots(normalized, new Set([root])));
    if (!root) throw new Error("此路径不在当前任务中用户明确提供的源码范围内，请提供原项目路径后继续，无需到应用配置中选择。");
    if (this.options.privateRoots.some(privateRoot => isPathWithinRoots(normalized, new Set([privateRoot])) || isPathWithinRoots(privateRoot, new Set([root])))) throw new Error("源码范围不能包含宿主私有配置或其他任务数据，请指定具体的项目目录。");
    const relative = path.relative(root, normalized);
    if ([...root.split(/[\\/]/), ...relative.split(/[\\/]/)].some(part => ignoredDirectories.has(part.toLowerCase()))) throw new Error("此目录保存凭证、浏览环境或生成文件，不属于源码读取范围。");
    // Check every component, including a selected root's parents (Windows junctions too).
    let cursor = path.parse(normalized).root;
    for (const part of normalized.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      this.options.check();
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error("源码读取不跟随符号链接或目录联接，请提供实际源码路径。");
    }
    if (!samePath(await realpath(root), root) || !samePath(await realpath(normalized), normalized)) throw new Error("源码路径已变化，请核对实际目录。");
    const info = await lstat(normalized);
    if (info.isFile() && !readableName(path.basename(normalized))) throw new Error("只读取源码、说明与项目定义文件；不读取凭证、二进制或业务数据文件。");
    this.options.check();
    return { normalized, root, info };
  }

  async read(input: SourceReadInput) {
    if (!["list", "readText", "readJson"].includes(input.method)) throw new Error("源码工具仅支持 list、readText、readJson。");
    const offset = input.offset ?? 1, limit = input.limit ?? 200;
    if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 300) throw new Error("源码分页 offset 从 1 开始，limit 为 1～300。");
    const { normalized, root, info } = await this.resolve(input.path);
    if (input.method === "list") {
      if (!info.isDirectory()) throw new Error("list 需要源码目录路径。");
      const all = await readdir(normalized, { withFileTypes: true });
      if (all.length > 10000) throw new Error("目录过大，请指定具体源码子目录。");
      const entries = all.filter(item => item.isDirectory() ? !ignoredDirectories.has(item.name.toLowerCase()) : item.isFile() && readableName(item.name))
        .sort((a, b) => a.name.localeCompare(b.name)).map(item => ({ name: item.name, kind: item.isDirectory() ? "directory" : "file", path: path.join(normalized, item.name) }));
      await this.resolve(normalized);
      return { path: normalized, entries: entries.slice(offset - 1, offset - 1 + limit), offset, nextOffset: offset - 1 + limit < entries.length ? offset + limit : null, total: entries.length, excluded: all.length - entries.length };
    }
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("源码文件不是普通文件或超过 2 MiB，请指定更小的源文件。");
    const handle = await open(normalized, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let text: string;
    try {
      const before = await handle.stat();
      if (before.dev !== info.dev || before.ino !== info.ino || !before.isFile()) throw new Error("源码文件已变化，请重新读取。");
      const bytes = Buffer.alloc(Math.min(MAX_BYTES, before.size) + 1); let length = 0;
      while (length < bytes.length) {
        this.options.check();
        const chunk = await handle.read(bytes, length, bytes.length - length, length);
        if (!chunk.bytesRead) break;
        length += chunk.bytesRead;
      }
      const after = await handle.stat(), current = await this.resolve(normalized);
      if (length > MAX_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || after.dev !== current.info.dev || after.ino !== current.info.ino || !samePath(await realpath(root), root)) throw new Error("源码文件在读取期间变化或过大，请保存完成后重试。");
      if (bytes.subarray(0, length).includes(0)) throw new Error("不能将二进制文件作为源码读取。");
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } finally { await handle.close(); }
    this.options.check();
    if (input.method === "readJson") {
      const value = redactJson(JSON.parse(text));
      if (Buffer.byteLength(JSON.stringify(value)) > 128000) throw new Error("JSON 内容较大，请改用 readText 分页读取。");
      return { path: normalized, value };
    }
    const redacted = redactText(text), lines = redacted.content.split(/\r?\n/), selected = lines.slice(offset - 1, offset - 1 + limit);
    const content = selected.join("\n");
    if (Buffer.byteLength(content) > 64000) throw new Error("此页源码较长，请减少 limit 后读取。");
    return { path: normalized, content, offset, lines: selected.length, totalLines: lines.length, nextOffset: offset - 1 + selected.length < lines.length ? offset + selected.length : null, credentialsRedacted: redacted.redacted };
  }
}
