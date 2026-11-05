import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { samePath } from "./paths";
import { isPathWithinRoots } from "./path-security";
import { AutomationAppError } from "./automation-app-package";
import type { AutomationAppDetail } from "./automation-app";
import { appActionConfigurationScope } from "./automation-app-actions";
import type { AppFileGrant, AppFileRef } from "./automation-app-run";
import type { AutomationAppStore } from "./automation-app-store";
import { pluginRelativePath } from "./haze-plugin-package";
import { appAiImageMime, AppAiInputError, MAX_APP_AI_IMAGE_BYTES, type AppAiImageBytes } from "./automation-app-ai-images";

export class AutomationAppFiles {
  constructor(private store: AutomationAppStore, private detail: AutomationAppDetail) {}
  private get grantsFile() { const scope = appActionConfigurationScope(this.detail); return path.join(this.detail.dataDirectory, ...(scope ? ["action-grants", `${scope}.json`] : ["grants.json"])); }
  async grants(): Promise<AppFileGrant[]> {
    try { const value = JSON.parse((await this.store.privateBytes(this.grantsFile, 256 * 1024)).toString("utf8")); if (value.schemaVersion !== 1 || !Array.isArray(value.grants) || value.grants.length > 256) throw new Error(); return value.grants; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw new AutomationAppError("文件授权记录不可读取，请重新选择文件。", 409); }
  }
  async grant(fieldId: string, selected: string, access: "read" | "readwrite"): Promise<AppFileRef> {
    const field = this.detail.ui.fields.find(f => f.id === fieldId), caps = this.detail.manifest.automation.capabilities;
    if (!field || !["file", "directory"].includes(field.type) || !path.isAbsolute(selected) || selected.includes("*") || !["read", "readwrite"].includes(access)) throw new AutomationAppError("请选择声明的文件或文件夹。");
    if (!caps.includes("files.read") || (access === "readwrite" && !caps.includes("files.write"))) throw new AutomationAppError("应用未声明相应的文件能力。");
    let resolved: string;
    try { resolved = await realpath(selected); } catch { throw new AutomationAppError("所选路径不存在或不可读取，请重新选择。"); }
    const info = await stat(resolved);
    if ((field.type === "file" && !info.isFile()) || (field.type === "directory" && !info.isDirectory())) throw new AutomationAppError("所选路径类型与配置项不一致。");
    // The private host tree cannot be granted through a broad parent selection.
    const workspace = this.detail.workspaceDirectory ?? path.join(this.detail.dataDirectory, "workspace");
    if (isPathWithinRoots(this.store.base, new Set([resolved])) || (isPathWithinRoots(resolved, new Set([this.store.base])) && !isPathWithinRoots(resolved, new Set([workspace])))) throw new AutomationAppError("请选择业务文件，不能授权宿主配置、插件代码或其他应用数据目录。");
    const host=getAgentDir();if(isPathWithinRoots(host,new Set([resolved]))||isPathWithinRoots(resolved,new Set([host]))&&!isPathWithinRoots(resolved,new Set([workspace])))throw new AutomationAppError("不能授权宿主私有配置或其他应用数据目录。");
    const grants = await this.grants(), id = randomUUID();
    const grant: AppFileGrant = { id, fieldId, path: resolved, kind: field.type as "file" | "directory", access, digest: this.detail.install.versions.find(v => v.version === this.detail.manifest.version)!.digest };
    if (appActionConfigurationScope(this.detail)) await this.store.ensureDataDirectory(path.dirname(this.grantsFile));
    await this.store.privateJson(this.grantsFile, { schemaVersion: 1, grants: [...grants.filter(g => g.fieldId !== fieldId), grant] });
    return { grantId: id, label: resolved, access } as AppFileRef;
  }
  async validateReferences(values: Record<string, unknown>, digest: string): Promise<AppFileGrant[]> {
    const grants = await this.grants(), selected: AppFileGrant[] = [];
    for (const field of this.detail.ui.fields.filter(f => ["file", "directory"].includes(f.type))) {
      const value = values[field.id]; if (value === null || value === undefined || value === "") continue;
      const grant = grants.find(g => g.id === (value as AppFileRef).grantId && g.fieldId === field.id && g.digest === digest);
      if (!grant || grant.kind !== field.type || !path.isAbsolute(grant.path) || grant.path.includes("*") || !["read", "readwrite"].includes(grant.access)) throw new AutomationAppError(`请为当前代码版本重新选择“${field.label}”。`, 409);
      try {
        const actual = await realpath(grant.path), info = await stat(actual);
        if (!samePath(actual, grant.path) || (grant.kind === "file" ? !info.isFile() : !info.isDirectory())) throw new Error();
      } catch { throw new AutomationAppError(`“${field.label}”的路径已变化或不可读取，请重新选择。`, 409); }
      selected.push(grant);
    }
    return selected;
  }
}

/** All host SDK file access resolves inside an explicit selection or app workspace. */
export class AppFileOperations {
  constructor(private workspace: string, private grants: AppFileGrant[], private capabilities: string[], private check: () => void) {}
  async readImage(ref: unknown): Promise<AppAiImageBytes> {
    let bytes: Buffer;
    try {
      const target = await this.resolve(ref);
      const handle = await open(target, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_APP_AI_IMAGE_BYTES) throw new AppAiInputError("AI 图片不是普通文件或超过 16 MiB。");
        // Bound the read even if a selected file grows after stat().
        const buffer = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < buffer.length) {
          this.check();
          const chunk = await handle.read(buffer, length, buffer.length - length, length);
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        this.check();
        if (length !== info.size) throw new AppAiInputError("AI 图片在读取期间发生变化，请文件保存完成后再运行。");
        bytes = buffer.subarray(0, length);
      } finally { await handle.close(); }
    } catch (error) {
      this.check();
      if (error instanceof AppAiInputError) throw error;
      throw new AppAiInputError("AI 图片读取失败，请检查应用的 files.read 能力、文件授权和文件是否仍然存在。");
    }
    if (bytes.length > MAX_APP_AI_IMAGE_BYTES) throw new AppAiInputError("AI 图片超过 16 MiB。");
    const mimeType = appAiImageMime(bytes);
    if (!mimeType) throw new AppAiInputError("AI 图片格式不支持；请选择 JPEG、PNG、WebP 或 GIF 图片。");
    return { bytes, mimeType };
  }
  private async resolve(ref: unknown, write = false): Promise<string> {
    this.check();
    if (!this.capabilities.includes(write ? "files.write" : "files.read")) throw new Error("应用未声明相应文件能力。");
    const value = ref as AppFileRef | null;
    if (!value || typeof value.grantId !== "string" || (value.relative !== undefined && typeof value.relative !== "string")) throw new Error("文件引用无效。");
    const grant = value.grantId === "workspace" ? { path: this.workspace, kind: "directory", access: "readwrite" } : this.grants.find(g => g.id === value.grantId);
    if (!grant || (write && grant.access !== "readwrite")) throw new Error("文件不在已授权范围内，或没有写入权限。");
    const root = grant.path, suffix = value.relative ?? "";
    if (suffix && pluginRelativePath(suffix) !== suffix) throw new Error("文件相对路径不规范。");
    if (path.isAbsolute(suffix) || suffix.includes("\\") || suffix.split("/").some(p => p === ".." || p === "." || /[\x00-\x1f<>:"|?*]/.test(p)) || (grant.kind === "file" && suffix)) throw new Error("文件相对路径无效。");
    const target = path.resolve(root, suffix);
    if (!isPathWithinRoots(target, new Set([root]))) throw new Error("文件路径越界。");
    if (!samePath(await realpath(root), root)) throw new Error("授权路径已变化。");
    let cursor = root;
    for (const part of suffix.split("/").filter(Boolean)) {
      cursor = path.join(cursor, part);
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("不跟随符号链接或目录联接。"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && write) break; throw e; }
    }
    return target;
  }
  async call(method: string, args: unknown[]): Promise<unknown> {
    const target = await this.resolve(args[0], ["writeText", "writeJson", "writeBase64", "mkdir"].includes(method));
    if (method === "list") {
      const items = await readdir(target, { withFileTypes: true }); if (items.length > 10000) throw new Error("目录超过 10000 项，请选择更小范围。");
      const ref = args[0] as AppFileRef;
      return Promise.all(items.filter(item => item.isFile() || item.isDirectory()).map(async item => {
        const info = await lstat(path.join(target, item.name));
        return { name: item.name, kind: info.isDirectory() ? "directory" : "file", size: info.size, modifiedAt: info.mtime.toISOString(), ref: { grantId: ref.grantId, relative: [ref.relative, item.name].filter(Boolean).join("/") } };
      }));
    }
    if (["readText", "readJson", "readBase64"].includes(method)) { const info = await stat(target); if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("文件不是普通文件或超过 16 MiB。"); const bytes = await readFile(target); this.check(); return method === "readBase64" ? bytes.toString("base64") : method === "readJson" ? JSON.parse(bytes.toString("utf8")) : bytes.toString("utf8"); }
    if (method === "mkdir") { await mkdir(target, { recursive: true }); this.check(); return { created: true }; }
    if (method === "writeText" || method === "writeJson") {
      const text = method === "writeJson" ? JSON.stringify(args[1], null, 2) : args[1]; if (typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("写入内容必须为不超过 16 MiB 的文本。");
      await mkdir(path.dirname(target), { recursive: true }); this.check(); await writeFile(target, text, { encoding: "utf8", flag: args[2] === true ? "w" : "wx" }); this.check(); return { bytes: Buffer.byteLength(text) };
    }
    if (method === "writeBase64") {
      if (typeof args[1] !== "string") throw new Error("二进制内容无效。"); const bytes = Buffer.from(args[1], "base64");
      if (bytes.length > 16 * 1024 * 1024 || bytes.toString("base64") !== args[1]) throw new Error("二进制内容无效或超过 16 MiB。");
      await mkdir(path.dirname(target), { recursive: true }); this.check(); await writeFile(target, bytes, { flag: args[2] === true ? "w" : "wx" }); this.check(); return { bytes: bytes.length };
    }
    if (method === "copy" || method === "move") {
      const destination = await this.resolve(args[1], true); if (method === "move") await this.resolve(args[0], true);
      const info = await stat(target); if (!info.isFile()) throw new Error("复制和移动只支持普通文件。");
      try { await lstat(destination); throw new Error("目标已存在，不会覆盖。"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      await mkdir(path.dirname(destination), { recursive: true }); this.check();
      if (method === "copy") await copyFile(target, destination, 1); else await rename(target, destination);
      this.check(); return { bytes: info.size };
    }
    throw new Error("文件操作不支持。");
  }
}
