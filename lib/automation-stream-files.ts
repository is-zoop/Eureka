import { createReadStream } from "node:fs";
import { lstat, mkdir, open, link, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import contract from "./automation-sdk-contract.json";

export const STREAM_LIMIT = contract.limits.downloadBytes;
export const CHUNK_LIMIT = contract.limits.fileChunkBytes;
export async function stageFile(resolve: () => Promise<string>, overwrite: boolean, check: () => void, maxBytes = STREAM_LIMIT) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > STREAM_LIMIT) throw new Error("文件大小上限应为 1 字节～1 GiB。");
  const target = await resolve();
  const checkTarget = async () => {
    check(); if (await resolve() !== target) throw new Error("目标授权已变化。");
    try { const info = await lstat(target); if (!overwrite || !info.isFile() || info.isSymbolicLink()) throw new Error("目标已存在或不是普通文件。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
  await checkTarget(); await mkdir(dirname(target), { recursive: true }); await resolve();
  const path = join(dirname(target), `.eureka-stream-${randomUUID().replaceAll("-", "")}.part`);
  let closed = false, initialized = false, size = 0, queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
  return {
    path, maxBytes,
    append(bytes: Buffer) { return serial(async () => {
      check(); if (closed || bytes.length > CHUNK_LIMIT || size + bytes.length > maxBytes) throw new Error("写入已关闭或超出分块/文件大小上限。");
      const handle = await open(path, initialized ? "a" : "wx");
      try { let offset = 0; while (offset < bytes.length) { check(); offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten; } size += bytes.length; initialized = true; }
      finally { await handle.close(); }
      return { bytes: size };
    }); },
    commit(expected?: { bytes?: number; sha256?: string }) { return serial(async () => {
      check(); if (closed) throw new Error("文件写入已结束。");
      // Empty files are valid. External native streaming creates the same private path.
      try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await (await open(path, "wx")).close(); }
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes || expected?.bytes !== undefined && expected.bytes !== info.size) throw new Error("文件大小或下载完整性校验失败。");
      const hash = createHash("sha256"); let count = 0;
      for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) { check(); count += chunk.length; if (count > maxBytes) throw new Error("文件超过大小上限。"); hash.update(chunk); }
      const sha256 = hash.digest("hex");
      if (count !== info.size || expected?.sha256 && expected.sha256.toLowerCase() !== sha256) throw new Error("文件长度或 SHA256 校验失败。");
      await checkTarget();
      if (overwrite) await rename(path, target); else { await link(path, target); await unlink(path); }
      closed = true; return { bytes: count, sha256 };
    }); },
    abort() { return serial(async () => { closed = true; await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }); },
  };
}
export type StagedFile = Awaited<ReturnType<typeof stageFile>>;
