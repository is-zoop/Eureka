import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const preference = await createJiti(import.meta.url).import("./completion-sound-preference.ts");
const KEY = "pi-sound-enabled";

function withWindow(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  const values = new Map();
  target.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return Promise.resolve().then(() => run(target, values)).finally(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
}

test("global sound defaults on and preserves both existing saved choices", () => withWindow((_target, values) => {
  assert.equal(preference.getCompletionSoundPreference(), true);
  values.set(KEY, "false");
  assert.equal(preference.getCompletionSoundPreference(), false);
  values.set(KEY, "true");
  assert.equal(preference.getCompletionSoundPreference(), true);
}));

test("all subscribers receive same-window changes, cross-tab changes and storage clearing", () => withWindow((target, values) => {
  const first = [], second = [];
  const unsubscribeFirst = preference.subscribeCompletionSoundPreference(() => first.push(preference.getCompletionSoundPreference()));
  const unsubscribeSecond = preference.subscribeCompletionSoundPreference(() => second.push(preference.getCompletionSoundPreference()));
  const storageEvent = (key) => {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  };
  try {
    preference.setCompletionSoundPreference(false);
    assert.equal(values.get(KEY), "false");
    values.set(KEY, "true");
    storageEvent(KEY);
    storageEvent("unrelated-setting");
    values.clear();
    storageEvent(null);
    assert.deepEqual(first, [false, true, true]);
    assert.deepEqual(second, first);
    unsubscribeFirst();
    preference.setCompletionSoundPreference(false);
    assert.deepEqual(first, [false, true, true]);
    assert.deepEqual(second, [false, true, true, false]);
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
}));

test("restricted storage does not crash settings or audio callbacks", () => withWindow((target) => {
  target.localStorage.getItem = () => { throw new Error("blocked"); };
  target.localStorage.setItem = () => { throw new Error("blocked"); };
  assert.equal(preference.getCompletionSoundPreference(), true);
  assert.doesNotThrow(() => preference.setCompletionSoundPreference(false));
}));

test("playback reads the global preference each time and rechecks it after pending audio resume", () => withWindow(async () => {
  const source = await readFile(new URL("../hooks/useAudio.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const cleanups = [];
  let starts = 0, contexts = 0, resume;
  const ctx = {
    state: "suspended", currentTime: 0, destination: {},
    resume: () => new Promise((resolve) => { resume = () => { ctx.state = "running"; resolve(); }; }),
    createOscillator: () => ({ connect() {}, frequency: {}, start() { starts++; }, stop() {} }),
    createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    AudioContext: function () { contexts++; return ctx; },
    require(name) {
      if (name === "react") return { useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect: (fn) => cleanups.push(fn()) };
      if (name === "@/lib/completion-sound-preference") return preference;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const audio = exports.useAudio();
  try {
    audio.playDoneSound();
    assert.equal(contexts, 1);
    preference.setCompletionSoundPreference(false);
    resume();
    await Promise.resolve();
    assert.equal(starts, 0);
    audio.playDoneSound();
    assert.equal(starts, 0);
    preference.setCompletionSoundPreference(true);
    audio.playDoneSound();
    assert.equal(starts, 2);
    preference.setCompletionSoundPreference(false);
    audio.playDoneSound();
    assert.equal(starts, 2);
    assert.equal(contexts, 1);
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
  }
}));
