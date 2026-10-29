import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { allowFileRoot } from "./allowed-roots";
import { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } from "./image-attachments";
import type { ChatDraftImage, ChatDraftReference } from "./draft-store";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 100;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".tif": "image/tiff", ".tiff": "image/tiff" };
export interface ComposerAttachments { references: ChatDraftReference[]; images: ChatDraftImage[] }

/** Explicit picker/clipboard selection grants only the selected file or directory. */
export async function resolveComposerAttachments(paths: unknown): Promise<ComposerAttachments> {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_ATTACHMENT_FILES || paths.some(p => typeof p !== "string" || !path.isAbsolute(p))) {
    throw new Error("Select 1–100 absolute file or folder paths.");
  }
  const selected = await Promise.all([...new Set(paths as string[])].map(async p => {
    const resolved = await realpath(p);
    const info = await stat(resolved);
    if (!info.isDirectory() && !info.isFile()) throw new Error(`Not a file or folder: ${p}`);
    const mimeType = info.isFile() ? IMAGE_TYPES[path.extname(resolved).toLowerCase()] : undefined;
    if (mimeType && info.size > MAX_ATTACHED_IMAGE_BYTES) throw new Error(`Image exceeds 10 MB: ${path.basename(p)}`);
    return { resolved, info, mimeType };
  }));
  if (selected.filter(p => p.mimeType).length > MAX_ATTACHED_IMAGES) throw new Error("Select at most 10 images.");
  const result: ComposerAttachments = { references: [], images: [] };
  for (const item of selected) {
    if (item.mimeType) result.images.push({ data: (await readFile(item.resolved)).toString("base64"), mimeType: item.mimeType });
    else result.references.push({ path: item.resolved, isDir: item.info.isDirectory() });
  }
  for (const reference of result.references) allowFileRoot(reference.path);
  return result;
}

/** Browsers hide original file paths; retain an independent local copy for the agent. */
export async function storeComposerFiles(files: File[], root = path.join(homedir(), ".pi", "agent", "attachments")): Promise<ComposerAttachments> {
  if (!files.length || files.length > MAX_ATTACHMENT_FILES) throw new Error("Select 1–100 files.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error("Attachments exceed 50 MB.");
  const directory = path.join(root, randomUUID());
  await mkdir(directory, { recursive: true });
  const references: ChatDraftReference[] = [];
  for (const [index, file] of files.entries()) {
    // Each file gets its own directory: duplicate names cannot overwrite each other.
    const name = path.win32.basename(path.posix.basename(file.name)).replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "attachment";
    const folder = path.join(directory, String(index));
    await mkdir(folder);
    const target = path.join(folder, /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name);
    await writeFile(target, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    references.push({ path: target, isDir: false });
  }
  references.forEach(reference => allowFileRoot(reference.path));
  return { references, images: [] };
}
