import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveComposerAttachments, storeComposerFiles, MAX_ATTACHMENT_BYTES } = await jiti.import("./composer-attachments.ts");
const { composerReferenceText } = await jiti.import("./composer-references.ts");
const { getAdditionalAllowedRoots } = await jiti.import("./allowed-roots.ts");

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "eureka-attachments-test-"));
  try { await run(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("eureka-attachments-test-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("mixed selections retain file/folder references and image bytes separately", () => fixture(async root => {
  const doc = path.join(root, "sales report.txt"), folder = path.join(root, "資料"), png = path.join(root, "image.png");
  await writeFile(doc, "hello"); await mkdir(folder); await writeFile(png, Buffer.from([137,80,78,71]));
  const result = await resolveComposerAttachments([doc, folder, png, doc]);
  assert.deepEqual(result.references, [{ path: doc, isDir: false }, { path: folder, isDir: true }]);
  assert.deepEqual(result.images, [{ data: Buffer.from([137,80,78,71]).toString("base64"), mimeType: "image/png" }]);
  assert.ok(getAdditionalAllowedRoots().has(doc.replace(/\\/g, "/")));
  assert.ok(!getAdditionalAllowedRoots().has(root.replace(/\\/g, "/")), "must not authorize the file's parent directory");
}));

test("browser files with duplicate or hostile names stay inside independent attachment folders", () => fixture(async root => {
  const files = [new File(["first"], "report.txt"), new File(["second"], "report.txt"), new File(["third"], "../../CON.txt")];
  const result = await storeComposerFiles(files, root);
  assert.equal(new Set(result.references.map(r => r.path)).size, 3);
  for (const [index, ref] of result.references.entries()) {
    assert.ok(!path.relative(root, ref.path).startsWith(".."));
    assert.equal(await readFile(ref.path, "utf8"), ["first", "second", "third"][index]);
  }
}));

test("invalid selections and oversized uploads are rejected before writing", async () => {
  await assert.rejects(resolveComposerAttachments(["relative.txt"]));
  await assert.rejects(resolveComposerAttachments(Array(101).fill("C:/file.txt")));
  await assert.rejects(storeComposerFiles([{ size: MAX_ATTACHMENT_BYTES + 1 }]));
});

test("paths with spaces and folder references survive prompt serialization", () => {
  assert.deepEqual(composerReferenceText([{ path: "C:\\My Files\\report.xlsx", isDir: false }, { path: "src", isDir: true }]), ['@"C:/My Files/report.xlsx"', '@src/']);
});
