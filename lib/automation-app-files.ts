import { createWriteStream } from "node:fs";
import { readZipFileEntries, writeZipEntry } from "./automation-zip";
import { APP_ZIP_FILE_MAX_BYTES, APP_ZIP_EXPANDED_MAX_BYTES } from "./automation-data-limits";
import { copyFile, link, unlink, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
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
import { stageFile, CHUNK_LIMIT, type StagedFile } from "./automation-stream-files";
import contract from "./automation-sdk-contract.json";

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
  private writers = new Map<string, StagedFile>();
  get hasOpenWriters() { return this.writers.size > 0; }
  constructor(private workspace: string, private grants: AppFileGrant[], private capabilities: string[], private check: () => void) {}
  readPath(ref: unknown) { return this.resolve(ref); }
  stage(ref: unknown, overwrite = false, maxBytes?: number) { return stageFile(() => this.resolve(ref, true), overwrite, this.check, maxBytes); }
  async dispose() { const writers = [...this.writers.values()]; this.writers.clear(); await Promise.allSettled(writers.map(writer => writer.abort())); }
  async prepareWrite(ref:unknown,overwrite=false){
    const target=await this.resolve(ref,true);
    try{const info=await lstat(target);if(!overwrite||!info.isFile())throw new Error("下载目标已存在或不是普通文件，不会覆盖。");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
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
    if (method === "readChunk") {
      const options = (args[1] ?? {}) as { offset?: number; length?: number }, offset = options.offset ?? 0, length = options.length ?? CHUNK_LIMIT;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > CHUNK_LIMIT) throw new Error("读取分块范围无效，单次最多 1 MiB。");
      const handle = await open(await this.resolve(args[0]), "r");
      try { const info = await handle.stat(); if (!info.isFile() || info.size > contract.limits.downloadBytes) throw new Error("仅支持不超过 1 GiB 的普通文件。"); const buffer = Buffer.alloc(Math.min(length, Math.max(0, info.size - offset))); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); this.check(); return { base64: buffer.subarray(0, bytesRead).toString("base64"), offset, nextOffset: offset + bytesRead, size: info.size, eof: offset + bytesRead >= info.size }; }
      finally { await handle.close(); }
    }
    if (method === "openWriter") {
      if (this.writers.size >= 8) throw new Error("同时打开的文件写入器最多 8 个。");
      const options = (args[1] ?? {}) as { overwrite?: boolean; maxBytes?: number };
      if (options.overwrite !== undefined && typeof options.overwrite !== "boolean") throw new Error("覆盖选项无效。");
      const writer = await this.stage(args[0], options.overwrite, options.maxBytes), id = randomUUID(); this.writers.set(id, writer); return { id };
    }
    if (["writeChunk", "commitWriter", "abortWriter"].includes(method)) {
      const writer = this.writers.get(String(args[0])); if (!writer) throw new Error("文件写入引用不属于本次运行或已关闭。");
      if (method === "writeChunk") { if (typeof args[1] !== "string" || args[1].length > Math.ceil(CHUNK_LIMIT / 3) * 4) throw new Error("写入分块超过 1 MiB。"); const bytes = Buffer.from(args[1], "base64"); if (bytes.toString("base64") !== args[1]) throw new Error("分块编码无效。"); return writer.append(bytes); }
      try { return method === "commitWriter" ? await writer.commit() : await writer.abort(); }
      finally { this.writers.delete(String(args[0])); await writer.abort(); }
    }
    if(method==="extractZip"){
      const raw=args[2]??{};
      if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(key=>!["overwrite","filenameEncoding"].includes(key)))throw new Error("ZIP 解压选项无效。");
      const options=raw as {overwrite?:boolean;filenameEncoding?:"utf-8"|"gb18030"|"auto"};
      if(options.overwrite!==undefined&&typeof options.overwrite!=="boolean"||options.filenameEncoding!==undefined&&!["utf-8","gb18030","auto"].includes(options.filenameEncoding))throw new Error("ZIP 解压选项无效。");
      const destination=await this.resolve(args[1],true),ref=args[1] as AppFileRef;
      try{if(!(await stat(destination)).isDirectory())throw new Error("ZIP 目标必须是目录。");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
      const archive=await this.resolve(args[0]);
      const files=await readZipFileEntries(archive,{archive:contract.limits.zipArchiveBytes,expanded:APP_ZIP_EXPANDED_MAX_BYTES,file:APP_ZIP_FILE_MAX_BYTES,entries:512,nameEncoding:options.filenameEncoding??"auto"},this.check);
      const entries=files.map(entry=>({...entry,ref:{grantId:ref.grantId,relative:[ref.relative,entry.name].filter(Boolean).join("/")}}));
      // Validate every destination and collision before staging the first file.
      for(const entry of entries){
        this.check();const target=await this.resolve(entry.ref,true);
        try{const info=await lstat(target);if(!options.overwrite||!info.isFile())throw new Error(`ZIP 目标已存在，未解压：${entry.name}`);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
      }
      const staged:{entry:typeof entries[number];temp:string}[]=[],written=[];
      try{
        // Expanded file bodies never cross worker IPC or become Base64 strings.
        for(const entry of entries){
          const target=await this.resolve(entry.ref,true);await mkdir(path.dirname(target),{recursive:true});await this.resolve(entry.ref,true);
          const temp=path.join(path.dirname(target),`.eureka-unzip-${randomUUID()}.part`);staged.push({entry,temp});
          await writeZipEntry(archive,entry,createWriteStream(temp,{flags:"wx",mode:0o600}),this.check);
        }
        // Publish only after every entry's size and CRC have been verified.
        for(const {entry,temp} of staged){
          this.check();const target=await this.resolve(entry.ref,true);
          if(options.overwrite)await rename(temp,target);
          else{
            try{await link(temp,target);}catch(error){
              if(!["ENOTSUP","EOPNOTSUPP","EPERM","EXDEV"].includes((error as NodeJS.ErrnoException).code??""))throw error;
              await copyFile(temp,target,1);
            }
            await unlink(temp);
          }
          written.push({name:entry.name,bytes:entry.size,ref:entry.ref});
        }
      }finally{await Promise.all(staged.map(({temp})=>unlink(temp).catch(()=>{})));}

      return {files:written,bytes:written.reduce((sum,file)=>sum+file.bytes,0)};
    }
    const target = await this.resolve(args[0], ["writeText", "writeJson", "writeBase64", "mkdir"].includes(method));
    if (method === "list") {
      const items = await readdir(target, { withFileTypes: true }); if (items.length > 10000) throw new Error("目录超过 10000 项，请选择更小范围。");
      const ref = args[0] as AppFileRef;
      return Promise.all(items.filter(item => item.isFile() || item.isDirectory()).map(async item => {
        const info = await lstat(path.join(target, item.name));
        return { name: item.name, kind: info.isDirectory() ? "directory" : "file", size: info.size, modifiedAt: info.mtime.toISOString(), ref: { grantId: ref.grantId, relative: [ref.relative, item.name].filter(Boolean).join("/") } };
      }));
    }
    if (["readText", "readJson", "readBase64"].includes(method)) { const info = await stat(target); if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("文件不是普通文件或超过 16 MiB。"); const bytes = await readFile(target); this.check(); if(method==="readText"){const encoding=args[1]??"utf-8";if(typeof encoding!=="string"||!["utf-8","utf8","gbk","gb18030","utf-16le"].includes(encoding))throw new Error("文本编码不支持。");return new TextDecoder(encoding,{fatal:true}).decode(bytes);}return method === "readBase64" ? bytes.toString("base64") : JSON.parse(bytes.toString("utf8")); }
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
