import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../ui/tray.js", import.meta.url), "utf8");

async function mount(initial = { sessions: [], ready: false, canCreate: false, theme: "auto" }) {
  const calls = [], listeners = new Map(), keys = new Map(), windowEvents = new Map(), classes = new Set(), timers = new Map();
  let timerId = 0;
  let document;
  const node = (tag = "div", id = "") => ({
    tag, id, children: [], dataset: {}, style: {}, attributes: {}, disabled: false, hidden: true, handlers: {}, clientWidth: 176, scrollWidth: 0,
    rect: { left: 14, top: 40, bottom: 74, width: 176, height: 34 },
    getBoundingClientRect() { return this.rect; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    replaceChildren(...children) { this.children = children; },
    focus() { if (document.activeElement === this) return; document.activeElement?.handlers.blur?.(); document.activeElement = this; this.handlers.focus?.(); },
    contains(target) { return this === target || this.children.some(n => n.contains(target)); },
    querySelectorAll() {
      return this.children.flatMap(n => [...(n.tag === "button" && !n.disabled ? [n] : []), ...n.querySelectorAll()]);
    },
  });
  const elements = new Map(["tray-menu", "recent-sessions", "new-task", "open", "settings", "quit", "tray-tooltip"].map(id => [id, node(["new-task", "open", "settings", "quit"].includes(id) ? "button" : "div", id)]));
  elements.get("tray-tooltip").rect = { width: 180, height: 48 };
  elements.get("tray-menu").children = ["recent-sessions", "new-task", "open", "settings", "quit"].map(id => elements.get(id));
  document = {
    activeElement: null,
    getElementById: id => elements.get(id),
    createElement: tag => node(tag),
    addEventListener: (name, handler) => keys.set(name, handler),
    documentElement: { classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) } },
  };
  runInNewContext(script, {
    console, document,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    window: {
      innerWidth: 220, innerHeight: 312,
      addEventListener: (name, handler) => windowEvents.set(name, handler),
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      __TAURI__: {
        core: { invoke: async (command, args) => { calls.push({ command, ...args }); return initial; } },
        event: { listen: async (name, listener) => { listeners.set(name, listener); } },
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, elements, listeners, document, classes, windowEvents, timers,
    flushTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
    pointer(target) { keys.get("pointerdown")({ target }); }, key(key) { keys.get("keydown")({ key, preventDefault() {} }); } };
}

test("tray popup updates recents and routes each click by stable session ID", async () => {
  const ui = await mount();
  assert.equal(ui.elements.get("recent-sessions").children[0].textContent, "暂无最近会话");
  assert.equal(ui.elements.get("new-task").disabled, true);
  assert.equal(ui.elements.get("settings").disabled, true);
  ui.listeners.get("desktop-tray-state")({ payload: { sessions: [{ id: "a", title: "A < B & C" }, { id: "b", title: "会话 B" }], ready: true, canCreate: true, theme: "dark" } });
  const rows = ui.elements.get("recent-sessions").children;
  assert.equal(rows[0].textContent, "A < B & C", "titles remain plain text");
  assert.equal(ui.classes.has("dark"), true);
  rows[1].handlers.click();
  assert.deepEqual(ui.calls.at(-1), { command: "select-session", sessionId: "b" });
  ui.elements.get("new-task").handlers.click();
  assert.equal(ui.calls.at(-1).command, "new-task");
  ui.elements.get("settings").handlers.click();
  assert.equal(ui.calls.at(-1).command, "settings");
  ui.elements.get("quit").handlers.click();
  assert.equal(ui.calls.at(-1).command, "quit");
});

test("tray keyboard navigation skips disabled items, wraps and dismisses with Escape or Tab", async () => {
  const ui = await mount();
  await ui.listeners.get("desktop-tray-open")();
  assert.equal(ui.document.activeElement.id, "open");
  ui.key("ArrowDown");
  assert.equal(ui.document.activeElement.id, "quit");
  ui.key("ArrowDown");
  assert.equal(ui.document.activeElement.id, "open");
  ui.key("End");
  assert.equal(ui.document.activeElement.id, "quit");
  ui.key("Home");
  assert.equal(ui.document.activeElement.id, "open");
  for (const key of ["Escape", "Tab"]) { ui.key(key); assert.equal(ui.calls.at(-1).command, "close"); }
});

test("tray popup displays at most three sessions and clears previous-account entries", async () => {
  const ui = await mount({ sessions: Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: `会话 ${i}` })), ready: true, canCreate: true, theme: "light" });
  assert.equal(ui.elements.get("recent-sessions").children.length, 3);
  ui.listeners.get("desktop-tray-state")({ payload: { sessions: [], ready: false, canCreate: false, theme: "light" } });
  const rows = ui.elements.get("recent-sessions").children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].disabled, true);
  assert.equal(ui.elements.get("settings").disabled, true);
});

test("tray blur and transparent margins dismiss without interfering with menu item clicks", async () => {
  const ui = await mount();
  const before = ui.calls.length;
  ui.pointer(ui.elements.get("open"));
  assert.equal(ui.calls.length, before);
  ui.pointer({});
  assert.equal(ui.calls.at(-1).command, "close");
  ui.windowEvents.get("blur")();
  assert.equal(ui.calls.at(-1).command, "close");
  ui.elements.get("open").handlers.click();
  assert.equal(ui.calls.at(-1).command, "open");
});

test("only truncated titles get a delayed accessible tooltip instead of a native title", async () => {
  const title = "保留完整会话名称以便在托盘中查看，不截断 tooltip 正文";
  const ui = await mount({ sessions: [{ id: "a", title }], ready: true, canCreate: true });
  const row = ui.elements.get("recent-sessions").children[0];
  const tooltip = ui.elements.get("tray-tooltip");
  assert.equal(row.title, undefined);
  row.handlers.pointerenter();
  assert.equal(ui.timers.size, 0, "short titles need no tooltip");
  row.scrollWidth = 400;
  row.handlers.pointerenter();
  assert.equal(tooltip.hidden, true);
  assert.equal([...ui.timers.values()][0].delay, 450);
  ui.flushTimers();
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, title);
  assert.equal(row.attributes["aria-describedby"], "tray-tooltip");
  row.handlers.pointerleave();
  assert.equal(tooltip.hidden, true);
  assert.equal(row.attributes["aria-describedby"], undefined);
  row.handlers.pointerenter();
  row.handlers.pointerleave();
  ui.flushTimers();
  assert.equal(tooltip.hidden, true, "leaving before the delay cancels the tooltip");
});

test("keyboard title tooltip stays inside the tray and clears on a menu update", async () => {
  const ui = await mount({ sessions: [{ id: "a", title: "长标题" }], ready: true, canCreate: true });
  const row = ui.elements.get("recent-sessions").children[0];
  row.scrollWidth = 400;
  row.rect = { left: 14, top: 284, bottom: 318 };
  ui.key("Home");
  ui.flushTimers();
  const tooltip = ui.elements.get("tray-tooltip");
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.top, "228px", "flip above a row near the bottom");
  ui.listeners.get("desktop-tray-state")({ payload: { sessions: [], ready: false, canCreate: false } });
  assert.equal(tooltip.hidden, true);
  assert.equal(row.attributes["aria-describedby"], undefined);
});
