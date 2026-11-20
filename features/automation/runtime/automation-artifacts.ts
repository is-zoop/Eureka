import { open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { AppFileOperations } from "./automation-app-files";
import contract from "../sdk/automation-sdk-contract.json";

export function validateArtifact(name: unknown, mediaType: unknown) {
  if (typeof name !== "string" || !/^[^\\/<>:"|?*\x00-\x1f\x7f]{1,120}$/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || typeof mediaType !== "string" || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;charset=utf-8)?$/.test(mediaType)) throw new Error("产物名称或类型无效。");
}
export async function snapshotArtifact(files: AppFileOperations, ref: unknown, target: string, check: () => void) {
  const source = await files.readPath(ref), input = await open(source, "r"); let created = false;
  try {
    const before = await input.stat(); if (!before.isFile() || before.size > contract.limits.artifactBytes) throw new Error("文件产物不是普通文件或超过 1 GiB。");
    const output = await open(target, "wx", 0o600); created = true;
    const buffer = Buffer.alloc(64 * 1024), hash = createHash("sha256"); let size = 0;
    try {
      for (;;) { check(); const { bytesRead } = await input.read(buffer, 0, buffer.length, size); if (!bytesRead) break; size += bytesRead; if (size > before.size) throw new Error("源文件在生成产物时发生变化。"); const data = buffer.subarray(0, bytesRead); hash.update(data); let offset = 0; while (offset < bytesRead) { const written = await output.write(data, offset, bytesRead - offset); if (!written.bytesWritten) throw new Error("无法保存文件产物。"); offset += written.bytesWritten; } }
      const after = await input.stat(); check(); if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("源文件在生成产物时发生变化。"); await output.sync();
    } finally { await output.close(); }
    return { size, sha256: hash.digest("hex") };
  } catch (error) { if (created) await unlink(target).catch(() => {}); throw error; } finally { await input.close(); }
}
export async function streamArtifact(path: string, size: number, check: () => void) {
  const file = await open(path, "r");
  try { const info = await file.stat(); if (!info.isFile() || info.size !== size || size > contract.limits.artifactBytes) throw new Error("产物大小已变化，请重新生成。"); check(); } catch (error) { await file.close(); throw error; }
  let position = 0, closed = false;
  const close = async () => { if (!closed) { closed = true; await file.close(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) { try { check(); if (position === size) { await close(); controller.close(); return; } const buffer = Buffer.alloc(Math.min(64 * 1024, size - position)); const { bytesRead } = await file.read(buffer, 0, buffer.length, position); if (!bytesRead) throw new Error("产物读取不完整。"); position += bytesRead; controller.enqueue(buffer.subarray(0, bytesRead)); } catch (error) { await close(); controller.error(error); } },
    async cancel() { await close(); }
  });
}
