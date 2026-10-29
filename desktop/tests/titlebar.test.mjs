import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../ui/titlebar.js", import.meta.url), "utf8");
const markup = await readFile(new URL("../ui/titlebar.html", import.meta.url), "utf8");
const directions = [...markup.matchAll(/data-resize-direction="([^"]+)"/g)].map(match => match[1]);

async function caption() {
  const calls = [], resizeCalls = [], listeners = new Map(), classes = new Set();
  const node = () => ({
    handlers: {}, dataset: {}, disabled: false,
    addEventListener(name, listener) { this.handlers[name] = listener; },
    setAttribute() {}, focus() {}, getBoundingClientRect: () => ({ left: 0 }),
  });
  const elements = new Map(["maximize", "minimize", "close", "logo", "back", "forward", "drag-region", "menu-file", "menu-edit", "menu-view", "menu-help", "brand"].map(id => [id, node()]));
  const regions = directions.map(direction => ({ ...node(), dataset: { resizeDirection: direction } }));
  const state = { maximized: false, fullscreen: false, focused: true, theme: "auto", menuReady: true };
  runInNewContext(script, {
    console,
    document: {
      getElementById: id => elements.get(id),
      querySelector: () => elements.get("brand"),
      querySelectorAll: () => regions,
      documentElement: { classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains: name => classes.has(name),
      } },
    },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      __TAURI__: {
        core: { invoke: async (command, args) => { calls.push({ command, ...args }); return state; } },
        event: { listen: async (name, listener) => { listeners.set(name, listener); } },
        window: { getCurrentWindow: () => ({ startResizeDragging: async direction => { resizeCalls.push(direction); } }) },
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { regions, calls, resizeCalls, elements, listeners, state, classes };
}

function mouse(button = 0) {
  return { button, detail: 1, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}

test("top edge and corners initiate native resize without initiating window movement", async () => {
  const ui = await caption();
  for (const region of ui.regions) {
    const event = mouse();
    region.handlers.mousedown(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(ui.resizeCalls, ["North", "NorthWest", "NorthEast"]);
  assert.equal(ui.calls.some(call => call.action === "drag"), false);
  ui.elements.get("drag-region").handlers.mousedown(mouse());
  assert.equal(ui.calls.at(-1).action, "drag", "normal titlebar dragging still works");
});

test("maximized/fullscreen captions disable resize and restore it in normal mode", async () => {
  const ui = await caption();
  const frame = state => ui.listeners.get("desktop-frame-state")({ payload: { ...ui.state, ...state } });
  for (const state of [{ maximized: true }, { fullscreen: true }]) {
    frame(state);
    assert.equal(ui.classes.has("non-resizable"), true);
    ui.regions[0].handlers.mousedown(mouse());
  }
  assert.deepEqual(ui.resizeCalls, []);
  frame({ maximized: false, fullscreen: false });
  ui.regions[0].handlers.mousedown(mouse());
  assert.deepEqual(ui.resizeCalls, ["North"]);
});

test("right and middle clicks on the top edge do not resize the window", async () => {
  const ui = await caption();
  ui.regions[0].handlers.mousedown(mouse(1));
  ui.regions[0].handlers.mousedown(mouse(2));
  assert.deepEqual(ui.resizeCalls, []);
});
