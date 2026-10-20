import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getPreferredToolPreset,
  setPreferredToolPreset,
  subscribeToolPresetPreference,
} = await jiti.import("./tool-preset-preference.ts");
const { TOOL_PRESET_VALUES } = await jiti.import("./tool-presets.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("defaults missing or invalid preferences to the default preset", () => {
  assert.equal(getPreferredToolPreset(createStorage()), "default");
  assert.equal(
    getPreferredToolPreset(createStorage({ "eureka-default-tool-preset": "legacy-value" })),
    "default",
  );
});

test("new sessions start with default instead of inheriting a legacy session choice", () => {
  for (const preset of TOOL_PRESET_VALUES) {
    const storage = createStorage({ "pi-tool-preset": preset });
    assert.equal(getPreferredToolPreset(storage), "default");
    setPreferredToolPreset("read-only", storage);
    assert.equal(getPreferredToolPreset(storage), "read-only");
    assert.equal(storage.values.get("pi-tool-preset"), preset);
  }
});

test("round-trips every supported tool preset", () => {
  const storage = createStorage();
  for (const preset of TOOL_PRESET_VALUES) {
    setPreferredToolPreset(preset, storage);
    assert.equal(storage.values.get("eureka-default-tool-preset"), preset);
    assert.equal(getPreferredToolPreset(storage), preset);
  }
});

test("falls back safely when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(getPreferredToolPreset(unavailable), "default");
  assert.doesNotThrow(() => setPreferredToolPreset("full", unavailable));
  assert.equal(getPreferredToolPreset(null), "default");
  assert.doesNotThrow(() => setPreferredToolPreset("full", null));
});

test("falls back when accessing window.localStorage throws", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: blockedWindow,
  });

  try {
    assert.equal(getPreferredToolPreset(), "default");
    assert.doesNotThrow(() => setPreferredToolPreset("full"));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("default changes notify fresh composers in the same window and other tabs", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  target.localStorage = createStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  let updates = 0;
  const unsubscribe = subscribeToolPresetPreference(() => updates++);
  try {
    setPreferredToolPreset("none");
    assert.equal(updates, 1);
    assert.equal(getPreferredToolPreset(), "none");
    const storageEvent = new Event("storage");
    Object.defineProperty(storageEvent, "key", { value: "eureka-default-tool-preset" });
    target.dispatchEvent(storageEvent);
    assert.equal(updates, 2);
    const unrelated = new Event("storage");
    Object.defineProperty(unrelated, "key", { value: "other-setting" });
    target.dispatchEvent(unrelated);
    assert.equal(updates, 2);
    unsubscribe();
    setPreferredToolPreset("full");
    assert.equal(updates, 2);
  } finally {
    unsubscribe();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
