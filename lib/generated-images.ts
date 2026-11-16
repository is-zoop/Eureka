import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { localAutomationPath } from "./automation-local-context";
import { getBase64DecodedByteLength } from "./image-attachments";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const formats: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
export class ImageGenerationError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export interface GeneratedImageRecord {
  id: string; provider: string; modelId: string; prompt: string; createdAt: number;
  status: "generating" | "completed" | "failed"; error?: string;
  mimeType?: string; bytes?: number; usage?: Usage;
}
export function parseImageGeneration(value: unknown) {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["id", "provider", "modelId", "prompt"].includes(k))
    || typeof v.id !== "string" || !UUID.test(v.id)
    || typeof v.provider !== "string" || !v.provider.trim() || v.provider.length > 200
    || typeof v.modelId !== "string" || !v.modelId.trim() || v.modelId.length > 300
    || typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 6000) throw new ImageGenerationError("invalid");
  return { id: v.id, provider: v.provider, modelId: v.modelId, prompt: v.prompt.trim() };
}
function usageSummary(value?: Usage): Usage | undefined {
  if (!value) return;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  return { input: n(value.input), output: n(value.output), cacheRead: n(value.cacheRead), cacheWrite: n(value.cacheWrite), totalTokens: n(value.totalTokens), cost: { input: n(value.cost?.input), output: n(value.cost?.output), cacheRead: n(value.cost?.cacheRead), cacheWrite: n(value.cost?.cacheWrite), total: n(value.cost?.total), ...(typeof value.cost?.totalFromProvider === "boolean" ? { totalFromProvider: value.cost.totalFromProvider } : {}) } };
}
export function decodeGeneratedImage(image: { mimeType: string; data: string }) {
  if (!Object.hasOwn(formats, image.mimeType) || typeof image.data !== "string" || image.data.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4) throw new ImageGenerationError("invalidImage", 502);
  const size = getBase64DecodedByteLength(image.data);
  if (!size || size > MAX_GENERATED_IMAGE_BYTES) throw new ImageGenerationError("invalidImage", 502);
  const bytes = Buffer.from(image.data, "base64");
  const matches = image.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : image.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!matches) throw new ImageGenerationError("invalidImage", 502);
  return bytes;
}
export class GeneratedImageStore {
  readonly root: string;
  constructor(readonly base: string, readonly owner: string, readonly check: () => void = () => {}) {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new ImageGenerationError("forbidden", 403);
    this.root = localAutomationPath(base, join(base, "generated-images", owner));
  }
  path(name: string) { this.check(); return localAutomationPath(this.base, join(this.root, name)); }
  get(id: string): GeneratedImageRecord | undefined {
    if (!UUID.test(id)) throw new ImageGenerationError("invalid");
    const file = this.path(`${id}.json`);
    if (!existsSync(file)) return;
    if (lstatSync(file).size > 64000) throw new ImageGenerationError("storage", 500);
    const record = JSON.parse(readFileSync(file, "utf8")) as GeneratedImageRecord;
    if (record.id !== id || !["generating", "completed", "failed"].includes(record.status)) throw new ImageGenerationError("storage", 500);
    return record;
  }
  list() {
    if (!existsSync(this.path(""))) return [];
    return readdirSync(this.root).filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5))).map(name => this.get(name.slice(0, -5))!).sort((a, b) => b.createdAt - a.createdAt);
  }
  save(record: GeneratedImageRecord) {
    this.check(); mkdirSync(this.path(""), { recursive: true, mode: 0o700 });
    const file = this.path(`${record.id}.json`), temp = this.path(`${record.id}.${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(record), { flag: "wx", mode: 0o600 }); this.check(); renameSync(temp, file);
  }
  image(record: GeneratedImageRecord) {
    if (record.status !== "completed" || !record.mimeType || !Object.hasOwn(formats, record.mimeType)) throw new ImageGenerationError("missing", 404);
    const file = this.path(`${record.id}.${formats[record.mimeType]}`);
    const size = lstatSync(file).size;
    if (size > MAX_GENERATED_IMAGE_BYTES) throw new ImageGenerationError("storage", 500);
    return readFileSync(file);
  }
  writeImage(record: GeneratedImageRecord, bytes: Buffer) {
    writeFileSync(this.path(`${record.id}.${formats[record.mimeType!]}`), bytes, { flag: "wx", mode: 0o600 });
  }
}
declare global { var __eurekaImageGenerationLocks: Set<string> | undefined; }
export async function generateOneImage(store: GeneratedImageStore, runtime: Pick<ModelRuntime, "getAvailableOfType" | "generateImages">, input: ReturnType<typeof parseImageGeneration>, signal: AbortSignal) {
  input = parseImageGeneration(input);
  store.check(); signal.throwIfAborted();
  const previous = store.get(input.id);
  if (previous) {
    if (previous.prompt !== input.prompt || previous.provider !== input.provider || previous.modelId !== input.modelId) throw new ImageGenerationError("conflict", 409);
    return previous; // Replaying a submission never makes another billed call.
  }
  const locks = globalThis.__eurekaImageGenerationLocks ??= new Set();
  if (locks.has(store.root)) throw new ImageGenerationError("busy", 409);
  locks.add(store.root);
  let record: GeneratedImageRecord | undefined;
  try {
    const records = store.list();
    if (records.length >= 200 || records.reduce((n, r) => n + (r.bytes ?? 0), 0) > 512 * 1024 * 1024 - MAX_GENERATED_IMAGE_BYTES) throw new ImageGenerationError("quota", 409);
    const model = (await runtime.getAvailableOfType("image")).find(m => m.provider === input.provider && m.id === input.modelId);
    store.check(); signal.throwIfAborted();
    if (!model) throw new ImageGenerationError("model", 400);
    record = { ...input, createdAt: Date.now(), status: "generating" }; store.save(record);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
    const result = await runtime.generateImages(model, { input: [{ type: "text", text: input.prompt }] }, {
      signal: deadline, timeoutMs: 300000, maxRetries: 0,
      onPayload: payload => payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload, n: 1 } : payload,
    });
    store.check();
    record.usage = usageSummary(result.usage);
    if (deadline.aborted || result.stopReason === "aborted") throw new ImageGenerationError("cancelled", 409);
    if (result.stopReason !== "stop") throw new ImageGenerationError("provider", 502);
    const images = result.output.filter(item => item.type === "image");
    if (images.length !== 1) throw new ImageGenerationError("invalidImage", 502);
    const bytes = decodeGeneratedImage(images[0]);
    record.mimeType = images[0].mimeType; record.bytes = bytes.byteLength;
    store.writeImage(record, bytes); record.status = "completed"; store.save(record);
    return record;
  } catch (error) {
    const safe = error instanceof ImageGenerationError ? error : new ImageGenerationError(signal.aborted ? "cancelled" : "provider", 502);
    if (record) { record.status = "failed"; record.error = safe.code; store.save(record); }
    throw safe;
  } finally { locks.delete(store.root); }
}
