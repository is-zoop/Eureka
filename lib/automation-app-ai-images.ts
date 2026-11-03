import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { getBase64DecodedByteLength } from "./image-attachments";
import { appJsonValue, type AppJson } from "./automation-app-run";

export const MAX_APP_AI_IMAGES = 10;
export const MAX_APP_AI_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 64000;

/** Safe, host-authored errors only; provider errors must not expose credentials. */
export class AppAiInputError extends Error {}
export interface AppAiImageBytes { bytes: Buffer; mimeType: string }
export type AppAiImageReader = (ref: unknown) => Promise<AppAiImageBytes>;
type ImageProcessor = typeof resizeImage;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function appAiImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function looksLikeImage(value: unknown): boolean {
  return object(value) && ["grantId", "base64", "data", "mediaType", "mimeType"].some(key => Object.hasOwn(value, key));
}

/** Remove legacy image payloads before enforcing the separate text limit. */
export function splitAppAiInput(input: unknown, options?: unknown): { text: AppJson; images: unknown[] } {
  if (options !== undefined && (!object(options) || Object.keys(options).some(key => key !== "images") || (options.images !== undefined && !Array.isArray(options.images)))) {
    throw new AppAiInputError("AI 图片参数无效，请使用第三个参数 {images:[文件引用]}。");
  }
  const images: unknown[] = [];
  let text = input;
  if (object(input)) {
    const clean = { ...input };
    const attach = (source: unknown) => { images.push(source); return { attachment: images.length }; };
    if (looksLikeImage(clean.image)) clean.image = attach(clean.image);
    if (Array.isArray(clean.images) && clean.images.length && clean.images.every(looksLikeImage)) clean.images = clean.images.map(attach);
    text = clean;
  }
  if (object(options) && Array.isArray(options.images)) {
    if (images.length + options.images.length > MAX_APP_AI_IMAGES) throw new AppAiInputError("一次 AI 判断最多支持 10 张图片，请分批处理。");
    images.push(...options.images);
  }
  if (images.length > MAX_APP_AI_IMAGES) throw new AppAiInputError("一次 AI 判断最多支持 10 张图片，请分批处理。");
  try { return { text: appJsonValue(text, MAX_TEXT_BYTES), images }; }
  catch { throw new AppAiInputError("AI 文字输入无效或超过 64,000 字节；图片请通过图片参数传入。"); }
}

function inlineImage(source: Record<string, unknown>): AppAiImageBytes {
  const data = source.base64 ?? source.data;
  const declared = source.mediaType ?? source.mimeType;
  if (typeof data !== "string" || data.length > Math.ceil(MAX_APP_AI_IMAGE_BYTES / 3) * 4) throw new AppAiInputError("AI 图片编码无效或超过 16 MiB。");
  const length = getBase64DecodedByteLength(data);
  if (!length || length > MAX_APP_AI_IMAGE_BYTES) throw new AppAiInputError("AI 图片编码无效或超过 16 MiB。");
  const bytes = Buffer.from(data, "base64"), mimeType = appAiImageMime(bytes);
  const declaredMime = typeof declared === "string" ? declared.toLowerCase().split(";")[0].trim().replace("image/jpg", "image/jpeg") : null;
  if (!mimeType || declaredMime !== mimeType) throw new AppAiInputError("AI 图片格式无效或与声明不符；支持 JPEG、PNG、WebP 和 GIF。");
  return { bytes, mimeType };
}

export async function prepareAppAiContent(
  input: ReturnType<typeof splitAppAiInput>, readImage: AppAiImageReader | undefined,
  check: () => void, processImage: ImageProcessor = resizeImage,
): Promise<(TextContent | ImageContent)[]> {
  const content: (TextContent | ImageContent)[] = [{ type: "text", text: JSON.stringify(input.text) }];
  let sourceBytes = 0, encodedBytes = 0;
  for (const [index, source] of input.images.entries()) {
    check();
    if (!object(source)) throw new AppAiInputError("AI 图片必须是已授权的文件引用或图片数据，不能是路径或网址。");
    let image: AppAiImageBytes;
    if (Object.hasOwn(source, "grantId")) {
      if (!readImage) throw new AppAiInputError("AI 图片文件读取未接入。");
      image = await readImage(source);
    } else image = inlineImage(source);
    sourceBytes += image.bytes.length;
    if (!image.bytes.length || sourceBytes > MAX_APP_AI_IMAGE_BYTES) throw new AppAiInputError("单次 AI 判断的原始图片总量超过 16 MiB，请分批处理。");
    check();
    let processed: Awaited<ReturnType<ImageProcessor>>;
    try {
      // Use Pi's public worker-backed processor, including EXIF handling and its
      // default 2000x2000 / 4.5 MiB encoded limits. Do not write to source files.
      processed = await processImage(image.bytes, image.mimeType);
    } catch { throw new AppAiInputError("AI 图片处理失败：Pi 图片处理组件无法完成解码或缩放。"); }
    check();
    if (!processed) throw new AppAiInputError("AI 图片处理失败：图片无法解码、缩放到限制内，或 Pi 图片处理组件不可用。");
    encodedBytes += Buffer.byteLength(processed.data);
    if (encodedBytes > MAX_APP_AI_IMAGE_BYTES) throw new AppAiInputError("处理后的图片总量超过 16 MiB，请分批处理。");
    const note = formatDimensionNote(processed);
    content.push({ type: "text", text: `Image ${index + 1}${note ? `\n${note}` : ""}` });
    content.push({ type: "image", data: processed.data, mimeType: processed.mimeType });
  }
  return content;
}
