import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./useSessionToolPermissions.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

// A deterministic hook scheduler lets the tests resolve network requests in any
// order without installing a DOM or relying on timing-sensitive sleeps.
function mount(options) {
  const slots = [];
  let cursor = 0, dirty = true, effects = [], controls;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (next) => { const value = typeof next === "function" ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const exports = {};
  runInNewContext(outputText, { exports, require: (name) => { assert.equal(name, "react"); return react; } });
  function render(next = {}) {
    Object.assign(options, next);
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; effects = [];
      controls = exports.useSessionToolPermissions(options);
      effects.forEach((effect) => effect());
      if (!dirty) return controls;
    }
    throw new Error("Hook failed to settle");
  }
  render();
  return { render, get controls() { return controls; } };
}

test("an explicit choice runs before the initial read and an older read cannot clear it", async () => {
  const read = deferred(), save = deferred();
  const calls = [];
  const options = { sessionId: "a", preset: "default", busy: false, locked: false, load: () => read.promise, apply: (preset) => { calls.push(preset); return save.promise; } };
  const hook = mount(options);
  const loading = hook.controls.load();
  hook.render();
  assert.equal(hook.controls.loading, true);
  const changing = hook.controls.change("default");
  hook.render();
  assert.deepEqual(calls, ["default"], "an unknown default still sends the explicit choice");
  assert.equal(hook.controls.pendingPreset, "default");
  save.resolve(true); await changing; hook.render();
  assert.equal(hook.controls.ready, true);
  read.resolve(false); await loading; hook.render();
  assert.equal(hook.controls.ready, true);
  assert.equal(hook.controls.saving, false);
  assert.equal(hook.controls.pendingPreset, null);
});

test("successful reads are reused until the session changes", async () => {
  let reads = 0;
  const hook = mount({ sessionId: "a", preset: "none", busy: false, locked: false, load: async () => { reads++; return true; }, apply: async () => true });
  await hook.controls.load(); hook.render();
  await hook.controls.load(); hook.render();
  assert.equal(reads, 1);
  assert.equal(hook.controls.ready, true);
  hook.render({ sessionId: "b" });
  assert.equal(hook.controls.ready, false);
  await hook.controls.load(); hook.render();
  assert.equal(reads, 2);
});

test("busy sessions keep the last choice and plan-locked sessions reject changes", async () => {
  const calls = [];
  const hook = mount({ sessionId: "a", preset: "default", busy: true, locked: false, load: async () => true, apply: async (preset) => { calls.push(preset); return true; } });
  await hook.controls.change("none"); hook.render();
  await hook.controls.change("read-only"); hook.render();
  assert.equal(hook.controls.pendingPreset, "read-only");
  assert.equal(calls.length, 0);
  hook.render({ busy: false });
  await Promise.resolve(); hook.render({ preset: "read-only" });
  assert.deepEqual(calls, ["read-only"]);
  hook.render({ locked: true });
  await hook.controls.change("full"); hook.render();
  assert.deepEqual(calls, ["read-only"]);
});

test("switching away and back ignores the earlier session read", async () => {
  const first = deferred();
  const hook = mount({ sessionId: "a", preset: "default", busy: false, locked: false, load: () => first.promise, apply: async () => true });
  const loading = hook.controls.load();
  hook.render({ sessionId: "b" });
  hook.render({ sessionId: "a", load: async () => true });
  await hook.controls.load(); hook.render();
  first.resolve(false); await loading; hook.render();
  assert.equal(hook.controls.ready, true);
});
