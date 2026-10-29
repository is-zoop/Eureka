import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../desktop/ui/titlebar.js", import.meta.url), "utf8");

async function mountTitlebar() {
  const elements = new Map();
  const calls = [];
  const invokes = [];
  const events = new Map();
  const keys = {};
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      disabled: true,
      listeners: {},
      attributes: {},
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect() { return { left: 120 }; },
      focus() {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
    });
    return elements.get(id);
  };
  const state = { theme: "light", focused: true, maximized: false, canGoBack: false, canGoForward: false, menuReady: true, menuLabels: ["文件", "编辑", "视图", "帮助"] };
  runInNewContext(source, {
    console,
    document: { documentElement: element("html"), getElementById: element, querySelector: element },
    window: {
      addEventListener(name, callback) { keys[name] = callback; },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      __TAURI__: {
        event: { listen: async (name, callback) => { events.set(name, callback); } },
        core: { invoke: async (command, args) => { calls.push([command, args.action]); invokes.push({ name: command, ...args }); return { ...state }; } },
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { element, calls, invokes, events, keys, receive: events.get("desktop-frame-state"), state };
}

test("titlebar disables unavailable directions and uses native navigation commands", async () => {
  const { element, calls, receive, state } = await mountTitlebar();
  assert.equal(element("back").disabled, true);
  assert.equal(element("forward").disabled, true);
  receive({ payload: { ...state, canGoBack: true } });
  assert.equal(element("back").disabled, false);
  assert.equal(element("forward").disabled, true);
  element("back").listeners.click();
  // The content view's newer response can arrive ahead of the command reply.
  receive({ payload: { ...state, canGoForward: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("forward").disabled, false);
  element("forward").listeners.click();
  assert.deepEqual(calls.slice(-2), [["desktop_window_action", "back"], ["desktop_window_action", "forward"]]);
});

test("caption menus open, switch on hover, and ignore stale close events", async () => {
  const { element, invokes, events } = await mountTitlebar();
  element("menu-file").listeners.click();
  assert.deepEqual(invokes.at(-1), { name: "desktop_open_menu", menu: "file", x: 120 });
  element("menu-view").listeners.mouseenter();
  events.get("desktop-menu-closed")({ payload: "file" });
  assert.equal(element("menu-view").attributes["aria-expanded"], "true");
  element("menu-view").listeners.click();
  assert.equal(invokes.at(-1).menu, null);
  element("menu-help").listeners.mouseenter();
  assert.equal(invokes.at(-1).menu, null);
});

test("caption keyboard actions reach the content view and readiness gates menus", async () => {
  const { element, invokes, keys, receive, state } = await mountTitlebar();
  const key = (key, more = {}) => keys.keydown({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault() {}, ...more });
  key("b", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(invokes.at(-1), { name: "desktop_dispatch_menu_action", command: "toggle-files" });
  key("F10");
  assert.equal(invokes.at(-1).menu, "file");
  receive({ payload: { ...state, menuReady: false } });
  const count = invokes.length;
  element("menu-file").listeners.click();
  assert.equal(invokes.length, count);
});

test("navigation controls are separate from window dragging", async () => {
  const { element, calls } = await mountTitlebar();
  assert.equal(element("back").listeners.mousedown, undefined);
  assert.equal(element("forward").listeners.mousedown, undefined);
  element("drag-region").listeners.mousedown({ button: 0, detail: 1 });
  element(".brand").listeners.mousedown({ button: 0, detail: 2 });
  assert.deepEqual(calls.slice(-2), [["desktop_window_action", "drag"], ["desktop_window_action", "maximize"]]);
});
