import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { FONT_SIZE_OPTIONS, FONT_SIZE_STORAGE_KEY, FONT_SIZE_BOOTSTRAP_SCRIPT, getPreferredFontSize, setPreferredFontSize } = await jiti.import("./font-size-preference.ts");

function storage(value = null) {
  return {
    getItem() { return value; },
    setItem(key, next) { assert.equal(key, FONT_SIZE_STORAGE_KEY); value = next; },
  };
}

test("defaults to small when the preference is missing or invalid", () => {
  for (const value of [null, "", "old-size", "LARGE"]) {
    assert.equal(getPreferredFontSize(storage(value)), "small");
  }
});

test("round-trips all three font sizes", () => {
  const saved = storage();
  for (const size of FONT_SIZE_OPTIONS) {
    setPreferredFontSize(size, saved);
    assert.equal(getPreferredFontSize(saved), size);
  }
});

test("tolerates denied storage without preventing the app from loading", () => {
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(getPreferredFontSize(denied), "small");
  assert.equal(getPreferredFontSize(null), "small");
  assert.doesNotThrow(() => setPreferredFontSize("large", denied));
  assert.doesNotThrow(() => setPreferredFontSize("large", null));
});

test("restores only a validated font size before hydration", () => {
  for (const value of [...FONT_SIZE_OPTIONS, null, 'large";throw new Error("injected")']) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(FONT_SIZE_BOOTSTRAP_SCRIPT, { document, localStorage: storage(value) });
    assert.equal(document.documentElement.dataset.eurekaFontSize, FONT_SIZE_OPTIONS.includes(value) ? value : "small");
  }
});

test("the bootstrap script falls back when access to storage itself is blocked", () => {
  const document = { documentElement: { dataset: {} } };
  const context = { document };
  Object.defineProperty(context, "localStorage", { get() { throw new Error("blocked"); } });
  assert.doesNotThrow(() => vm.runInNewContext(FONT_SIZE_BOOTSTRAP_SCRIPT, context));
  assert.equal(document.documentElement.dataset.eurekaFontSize, "small");
});
