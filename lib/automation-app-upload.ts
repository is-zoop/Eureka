import { open, unlink, mkdtemp, rmdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { AppFileOperations } from "./automation-app-files";
import type { AppSessionRequest, AppSessionRequestInput } from "./automation-session-request";
import contract from "./automation-sdk-contract.json";

/** Copies authorized input into a private, per-request snapshot outside worker grants. */
export async function prepareAppUpload(files: AppFileOperations, declaration: AppSessionRequest, input: AppSessionRequestInput, directory: string, check: () => void, browser = false) {
  if (!declaration.multipart || !input.multipart) throw new Error("上传未声明。");
  const root = await mkdtemp(join(directory, "upload-")), paths: string[] = [], directories: string[] = [];
  const dispose = async () => { await Promise.all(paths.map(path => unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }))); for (const directory of directories) await rmdir(directory); await rmdir(root).catch(error => { if (error.code !== "ENOENT") throw error; }); };
  let total = 0;
  try {
    const snapshots = [];
    for (const value of input.multipart.files) {
      check(); const specification = declaration.multipart.files.find(field => field.name === value.name); if (!specification) throw new Error("上传字段未声明。");
      const source = await files.readPath(value.ref), filename = value.filename ?? basename(source);
      if (!filename || filename.length > 200 || /[\\/\x00-\x1f<>:"|?*]/.test(filename) || filename === "." || filename === ".." || /[. ]$/.test(filename) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) throw new Error("上传文件名无效。");
      const folder = browser ? join(root, `.eureka-upload-${randomUUID().replaceAll("-", "")}`) : root;
      if (browser) { await mkdir(folder); directories.push(folder); }
      const sourceHandle = await open(source, "r"), path = join(folder, browser ? filename : `.eureka-upload-${randomUUID().replaceAll("-", "")}.part`); paths.push(path);
      try {
        const info = await sourceHandle.stat(), maxBytes = specification.maxBytes ?? declaration.multipart.maxBytes ?? contract.limits.uploadBytes;
        if (!info.isFile() || info.size > maxBytes || total + info.size > (declaration.multipart.maxBytes ?? contract.limits.uploadBytes)) throw new Error("上传文件大小超出声明。");
        const destination = await open(path, "wx", 0o600), buffer = Buffer.alloc(64 * 1024), hash = createHash("sha256"); let size = 0;
        try { for (;;) { check(); const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, size); if (!bytesRead) break; size += bytesRead; if (size > info.size || size > maxBytes) throw new Error("上传源文件在准备时发生变化。"); hash.update(buffer.subarray(0, bytesRead)); let offset = 0; while (offset < bytesRead) { const written = (await destination.write(buffer, offset, bytesRead - offset)).bytesWritten; if (!written) throw new Error("无法写入上传快照。"); offset += written; } } await destination.sync(); }
        finally { await destination.close(); }
        const after = await sourceHandle.stat(); if (size !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("上传源文件在准备时发生变化。");
        total += size; snapshots.push({ name: value.name, path, size, sha256: hash.digest("hex"), filename, contentType: value.contentType ?? "application/octet-stream" });
      } finally { await sourceHandle.close(); }
    }
    check(); return { input: { ...input, multipart: { fields: input.multipart.fields ?? {}, files: snapshots } }, dispose };
  } catch (error) { await dispose(); throw error; }
}
