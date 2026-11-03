// Regression sources only. The user runs these; no native dialog or real file is opened.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { saveFileAs, saveFilePayload } = await createJiti(import.meta.url).import("./save-file.ts");
async function withWindow(value, task) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  try { await task(); } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; }
}
test("native payload preserves a Unicode name and every binary byte without a destination path", () => {
  const raw = saveFilePayload("商品.csv", new Uint8Array([0, 255, 10]));
  const size = new DataView(raw.buffer).getUint32(0);
  assert.equal(new TextDecoder().decode(raw.slice(4, 4 + size)), "商品.csv");
  assert.deepEqual([...raw.slice(4 + size)], [0, 255, 10]);
  for (const name of ["", "../file.csv", "C:\\file.csv", "bad\nname"]) assert.throws(() => saveFilePayload(name, new Uint8Array()));
});
test("cancelling Save As is silent and does not fetch or write", async () => {
  await withWindow({ showSaveFilePicker: async () => { throw new DOMException("cancel", "AbortError"); } }, async () => {
    let fetched = false;
    assert.equal(await saveFileAs("report.json", async () => { fetched = true; return new Blob(); }), false);
    assert.equal(fetched, false);
  });
});
test("the picker opens before fetching, and success waits for the write to close", async () => {
  const events = [];
  await withWindow({ showSaveFilePicker: async ({ suggestedName }) => {
    events.push(`choose:${suggestedName}`);
    return { createWritable: async () => ({ write: async blob => events.push(await blob.text()), close: async () => events.push("closed"), abort: async () => events.push("abort") }) };
  } }, async () => {
    assert.equal(await saveFileAs("report.json", async () => { events.push("fetch"); return new Blob(["actual data"]); }), true);
    assert.deepEqual(events, ["choose:report.json", "fetch", "actual data", "closed"]);
  });
});
test("a failed write aborts the browser writer and never reports success", async () => {
  let aborted = false;
  await withWindow({ showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async () => { throw new Error("disk full"); }, close: async () => assert.fail("must not close"), abort: async () => { aborted = true; } }) }) }, async () => {
    await assert.rejects(saveFileAs("report.csv", async () => new Blob(["data"])), /disk full/);
    assert.equal(aborted, true);
  });
});
test("an unavailable picker never falls back to an automatic download", async () => {
  await withWindow({}, async () => { await assert.rejects(saveFileAs("report.csv", async () => assert.fail("must not fetch")), /不支持选择保存路径/); });
});
