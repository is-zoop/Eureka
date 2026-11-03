// Regression sources only. No model/network calls; the developer does not run these checks.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { splitAppAiInput, prepareAppAiContent, MAX_APP_AI_IMAGE_BYTES } = await jiti.import("./automation-app-ai-images.ts");
const { AppFileOperations } = await jiti.import("./automation-app-files.ts");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const noCheck = () => {};
const resized = { data: png.toString("base64"), mimeType: "image/png", originalWidth: 1, originalHeight: 1, width: 1, height: 1, wasResized: false };

test("existing text-only AI inputs do not invoke file reading or image processing", async () => {
  const input = { rows: ["咨询", "投诉"], count: 0, confirmed: false };
  const content = await prepareAppAiContent(splitAppAiInput(input), async () => { throw new Error("unexpected read"); }, noCheck, async () => { throw new Error("unexpected image processing"); });
  assert.deepEqual(content, [{ type: "text", text: JSON.stringify(input) }]);
});

test("legacy Base64 images bypass only the text size limit and become real image blocks", async () => {
  const bytes = Buffer.concat([png, Buffer.alloc(100000)]), base64 = bytes.toString("base64");
  const raw = { question: "classify", image: { mediaType: "image/png", base64 } };
  const split = splitAppAiInput(raw);
  assert.deepEqual(split.text, { question: "classify", image: { attachment: 1 } });
  let calls = 0;
  const content = await prepareAppAiContent(split, undefined, noCheck, async (received, mime, options) => {
    calls++; assert.deepEqual(received, bytes); assert.equal(mime, "image/png"); assert.equal(options, undefined);
    return resized;
  });
  assert.equal(calls, 1);
  assert.deepEqual(content.filter(c => c.type === "image"), [{ type: "image", data: resized.data, mimeType: "image/png" }]);
  assert(!content.filter(c => c.type === "text").some(c => c.text.includes(base64)));
  assert.equal(raw.image.base64, base64);
  assert.throws(() => splitAppAiInput({ text: "x".repeat(64001) }), /64,000/);
});

test("file references stay out of model text and failures never fall back to encoded text", async () => {
  const ref = { grantId: "selected", relative: "private.png" };
  const split = splitAppAiInput({ question: "classify" }, { images: [ref] });
  let reads = 0;
  const content = await prepareAppAiContent(split, async received => {
    reads++; assert.deepEqual(received, ref); return { bytes: png, mimeType: "image/png" };
  }, noCheck, async () => resized);
  assert.equal(reads, 1);
  assert(!JSON.stringify(content).includes(ref.relative));
  await assert.rejects(prepareAppAiContent(split, async () => ({ bytes: png, mimeType: "image/png" }), noCheck, async () => null), /图片处理失败/);
  await assert.rejects(prepareAppAiContent(split, undefined, noCheck, async () => resized), /文件读取未接入/);
  await assert.rejects(prepareAppAiContent(splitAppAiInput({}, { images: ["C:/private.png"] }), undefined, noCheck), /文件引用/);
});

test("invalid image data, counts and source sizes fail explicitly before model invocation", async () => {
  assert.throws(() => splitAppAiInput({}, { images: Array(11).fill({ grantId: "x" }) }), /10 张/);
  assert.throws(() => splitAppAiInput({}, { images: "invalid" }), /参数无效/);
  await assert.rejects(prepareAppAiContent(splitAppAiInput({ image: { mediaType: "image/png", base64: "not base64" } }), undefined, noCheck), /编码无效/);
  await assert.rejects(prepareAppAiContent(splitAppAiInput({ image: { mediaType: "image/jpeg", base64: png.toString("base64") } }), undefined, noCheck), /格式无效/);
  let processed = false;
  await assert.rejects(prepareAppAiContent(splitAppAiInput({}, { images: [{ grantId: "x" }] }), async () => ({ bytes: Buffer.alloc(MAX_APP_AI_IMAGE_BYTES + 1), mimeType: "image/png" }), noCheck, async () => { processed = true; return resized; }), /16 MiB/);
  assert.equal(processed, false);
});

test("cancellation during image processing discards the prepared result", async () => {
  let stopped = false;
  const check = () => { if (stopped) throw new Error("stopped"); };
  await assert.rejects(prepareAppAiContent(splitAppAiInput({ image: { mediaType: "image/png", base64: png.toString("base64") } }), undefined, check, async () => { stopped = true; return resized; }), /stopped/);
});

test("host image reads obey existing file grants, capabilities and relative-path boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "eureka-ai-image-")), selected = join(root, "selected");
  try {
    await mkdir(selected); await writeFile(join(selected, "input.png"), png); await writeFile(join(root, "outside.png"), png);
    const grant = { id: "selected", path: selected, kind: "directory", access: "read" };
    const files = new AppFileOperations(join(root, "workspace"), [grant], ["files.read"], noCheck);
    const read = await files.readImage({ grantId: "selected", relative: "input.png" });
    assert.deepEqual(read, { bytes: png, mimeType: "image/png" });
    assert.deepEqual(await readFile(join(selected, "input.png")), png);
    for (const ref of [{ grantId: "revoked", relative: "input.png" }, { grantId: "selected", relative: "../outside.png" }]) await assert.rejects(files.readImage(ref), /图片读取失败/);
    const denied = new AppFileOperations(join(root, "workspace"), [grant], [], noCheck);
    await assert.rejects(denied.readImage({ grantId: "selected", relative: "input.png" }), /files.read/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
