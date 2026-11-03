import { launchBrowserWindow, type NativeBrowserWindow } from "./browser-window-launcher";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Browser, BrowserContext, Page, CDPSession } from "playwright";
import type { BrowserState, BrowserEvent, BrowserAction, BrowserPresentation } from "./browser-types";
import { readRuntimeHazeSession } from "./auth/runtime-session";

type Tab = { id: string; page: Page; cdp: CDPSession; streaming: boolean; chain: Promise<unknown>; reuseKey?: string; opened?: boolean; title?: string; loading?: boolean };
type Entry = { nativeWindow?: NativeBrowserWindow; requestRouting?: boolean; presentation?: BrowserPresentation; panelSize?: { width: number; height: number }; tabStarts?: Map<Page, Promise<Tab>>; key: string; owner: string; sessionId: string; context: BrowserContext; tabs: Map<string, Tab>; activeTabId: string | null; error?: string; openRevision?: number; timer?: ReturnType<typeof setTimeout>; closing?: boolean; openChain: Promise<unknown> };
type Listener = (event: BrowserEvent) => void;
type Store = { nativeWindows?: Set<NativeBrowserWindow>; nativeCleanupInstalled?: boolean; browser?: Promise<Browser>; windowBrowser?: Promise<Browser>; entries: Map<string, Entry>; starting: Map<string, Promise<Entry>>; listeners: Map<string, Set<Listener>>; viewers: Map<string, Set<Listener>>; cleanupInstalled?: boolean };
declare global { var __eurekaBrowserRuntime: Store | undefined }
const store: Store = globalThis.__eurekaBrowserRuntime ??= { entries: new Map(), starting: new Map(), listeners: new Map(), viewers: new Map() };
const IDLE_MS = 10 * 60_000;
export function browserOwner(source: string, subject: string) { return JSON.stringify([source.replace(/\/$/, ""), subject]); }
function key(owner: string, sessionId: string) { return JSON.stringify([owner, sessionId]); }
function currentOwner() {
  const session = readRuntimeHazeSession();
  return session && process.env.EUREKA_AUTH_HAZE_ISSUER ? browserOwner(process.env.EUREKA_AUTH_HAZE_ISSUER, session.principal.subject) : null;
}
function assertOwner(owner: string) { if (currentOwner() !== owner) throw new Error("登录身份已变化，请重新登录并打开浏览器"); }
export function browserUrl(value: unknown): string {
  if (value === "about:blank") return value;
  if (typeof value !== "string" || value.length > 16_384) throw new Error("网页地址无效");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入完整的 HTTP/HTTPS 网页地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("仅支持不含用户名密码的 HTTP/HTTPS 网页地址");
  return url.href;
}
function displayUrl(url: string) {
  try { const parsed = new URL(url); parsed.hash = ""; parsed.search = ""; return parsed.href; } catch { return "about:blank"; }
}
export function browserState(owner: string, sessionId: string): BrowserState {
  const entry = store.entries.get(key(owner, sessionId));
  return { sessionId, presentation: entry?.presentation, openRevision: entry?.openRevision ?? 0, activeTabId: entry?.activeTabId ?? null, tabs: entry ? [...entry.tabs.values()].map((tab) => ({ id: tab.id, title: tab.page.isClosed() ? "已关闭" : tab.title || "网页", url: displayUrl(tab.page.url()), loading: Boolean(tab.loading) })) : [], ...(entry?.error ? { error: entry.error } : {}) };
}
function publish(entry: Entry, event?: BrowserEvent) {
  if (entry.closing) return;
  for (const listener of (event?.type === "frame" ? store.viewers.get(entry.key) : store.listeners.get(entry.key)) ?? []) listener(event ?? { type: "state", state: browserState(entry.owner, entry.sessionId) });
}
function report(entry: Entry, message: string) { entry.error = message; publish(entry); }
function runtimeExecutable(fallback: string) {
  if (process.env.EUREKA_BROWSER_EXECUTABLE) return process.env.EUREKA_BROWSER_EXECUTABLE;
  const descriptor = resolve(process.cwd(), "browser", "runtime.json");
  if (existsSync(descriptor)) {
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    return resolve(process.cwd(), "browser", value.executable);
  }
  return fallback;
}
async function browser(presentation?: "window") {
  const slot = presentation === "window" ? "windowBrowser" : "browser";
  if (!store[slot]) {
    const launching: Promise<Browser> = import("playwright").then(async ({ chromium }) => {
      const executablePath = runtimeExecutable(chromium.executablePath());
      if (!existsSync(executablePath)) throw new Error("未安装 Chromium，请运行 npm run browser:install 后重试。");
      const instance = await chromium.launch({ headless: presentation !== "window", executablePath });
      instance.on("disconnected", () => {
        if (store[slot] !== launching) return;
        store[slot] = undefined;
        for (const entry of store.entries.values()) if (entry.presentation === presentation) {
          report(entry, "浏览器连接已断开，请重新打开。");
          void closeBrowser(entry.owner, entry.sessionId);
        }
      });
      return instance;
    }).catch((error) => { if (store[slot] === launching) store[slot] = undefined; throw error; });
    store[slot] = launching;
  }
  return store[slot]!;
}
export async function browserReady() {
  const { chromium } = await import("playwright");
  return existsSync(runtimeExecutable(chromium.executablePath()));
}
function scheduleIdle(entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  // Automation sessions survive panel hiding and can also be used directly.
  if (entry.nativeWindow || store.viewers.get(entry.key)?.size) return;
  entry.timer = setTimeout(() => { void closeBrowser(entry.owner, entry.sessionId); }, IDLE_MS);
  entry.timer.unref?.();
}
async function stream(entry: Entry, tab: Tab, enabled: boolean) {
  if (tab.streaming === enabled || tab.page.isClosed()) return;
  tab.streaming = enabled;
  try {
    await tab.cdp.send(enabled ? "Page.startScreencast" : "Page.stopScreencast", enabled ? { format: "jpeg", quality: 75, everyNthFrame: 1 } : {});
  } catch { tab.streaming = false; }
}
function refreshStreams(entry: Entry) {
  for (const tab of entry.tabs.values()) void stream(entry, tab, Boolean(entry.presentation !== "window" && store.viewers.get(entry.key)?.size && entry.activeTabId === tab.id));
}
async function addTab(entry: Entry, page: Page, reuseKey?: string): Promise<Tab> {
  entry.tabStarts ??= new Map();
  const pending = entry.tabStarts.get(page);
  if (pending) { const tab = await pending; if (reuseKey) tab.reuseKey = reuseKey; return tab; }
  const started = createTab(entry, page, reuseKey);
  entry.tabStarts.set(page, started);
  try { return await started; } finally { entry.tabStarts.delete(page); }
}
async function createTab(entry: Entry, page: Page, reuseKey?: string): Promise<Tab> {
  const existing = [...entry.tabs.values()].find((tab) => tab.page === page);
  if (existing) { if (reuseKey) existing.reuseKey = reuseKey; return existing; }
  const cdp = await entry.context.newCDPSession(page);
  await cdp.send("Page.enable");
  const tab: Tab = { id: randomUUID(), page, cdp, streaming: false, chain: Promise.resolve(), reuseKey };
  entry.tabs.set(tab.id, tab);
  entry.activeTabId = tab.id;
  cdp.on("Page.screencastFrame", (frame) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    if (entry.activeTabId === tab.id && tab.streaming) publish(entry, { type: "frame", tabId: tab.id, data: frame.data, width: frame.metadata.deviceWidth, height: frame.metadata.deviceHeight });
  });
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) publish(entry); });
  page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) { tab.loading = true; publish(entry); } });
  page.on("requestfailed", (request) => { if (request.isNavigationRequest()) { tab.loading = false; publish(entry); } });
  page.on("domcontentloaded", () => { tab.loading = false; void page.title().then((title) => { tab.title = title; publish(entry); }).catch(() => {}); });
  page.on("close", () => { entry.tabs.delete(tab.id); if (entry.activeTabId === tab.id) entry.activeTabId = [...entry.tabs.keys()].at(-1) ?? null; refreshStreams(entry); publish(entry); if (entry.nativeWindow && !entry.tabs.size && !entry.context.pages().length && !entry.closing) void closeBrowser(entry.owner, entry.sessionId); });
  page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); report(entry, "网页弹出了对话框，已取消；本期不支持网页对话框交互。"); });
  page.on("filechooser", () => report(entry, "本期不支持网页文件上传。"));
  page.on("download", (download) => { void download.cancel().catch(() => {}); report(entry, "本期不支持网页文件下载。"); });
  if (entry.presentation === "embedded") await embedTab(entry, tab);
  refreshStreams(entry); publish(entry);
  return tab;
}
async function ensure(owner: string, sessionId: string, presentation?: BrowserPresentation): Promise<Entry> {
  assertOwner(owner);
  const id = key(owner, sessionId);
  const existing = store.entries.get(id);
  if (existing && !existing.closing) {
    if (presentation && !existing.nativeWindow) {
      await closeBrowser(owner, sessionId);
      return ensure(owner, sessionId, presentation);
    }
    return existing;
  }
  const starting = store.starting.get(id);
  if (starting) { await starting; return ensure(owner, sessionId, presentation); }
  const pending = (async () => {
    let nativeWindow: NativeBrowserWindow | undefined;
    let context: BrowserContext;
    if (presentation) {
      const { chromium } = await import("playwright");
      nativeWindow = await launchBrowserWindow(runtimeExecutable(chromium.executablePath()), { minimized: presentation === "embedded" });
      context = nativeWindow.context;
      (store.nativeWindows ??= new Set()).add(nativeWindow);
    } else {
      const instance = await browser();
      assertOwner(owner);
      context = await instance.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, acceptDownloads: false });
    }
    try { assertOwner(owner); } catch (error) {
      if (nativeWindow) { store.nativeWindows?.delete(nativeWindow); await nativeWindow.close(); } else await context.close();
      throw error;
    }
    const entry: Entry = { nativeWindow, requestRouting: !nativeWindow, presentation, key: id, owner, sessionId, context, tabs: new Map(), activeTabId: null, openChain: Promise.resolve() };
    try {
      store.entries.set(id, entry);
      // Plugin panels retain their navigation guard. Automation uses the
      // browser's native networking/cache in both display modes.
      // All URLs submitted through Eureka are still validated by browserUrl().
      if (entry.requestRouting) await context.route("**/*", async (route) => {
        if (route.request().isNavigationRequest() && !/^https?:\/\//i.test(route.request().url())) return route.abort();
        return route.continue();
      });
      context.on("page", (page) => { void page.opener().then((opener) => opener || nativeWindow ? addTab(entry, page) : undefined).catch(() => report(entry, "无法创建浏览器标签页")); });
      context.on("close", () => { if (!entry.closing) void closeBrowser(owner, sessionId); });
      if (nativeWindow) {
        nativeWindow.browser.on("disconnected", () => { if (!entry.closing) void closeBrowser(owner, sessionId); });
        for (const page of context.pages()) await addTab(entry, page);
      }
      scheduleIdle(entry);
      return entry;
    } catch (error) {
      entry.closing = true;
      store.entries.delete(id);
      if (nativeWindow) { store.nativeWindows?.delete(nativeWindow); await nativeWindow.close().catch(() => {}); }
      else await context.close().catch(() => {});
      throw error;
    }
  })();
  store.starting.set(id, pending);
  try { return await pending; } finally { store.starting.delete(id); }
}
export async function openBrowser(owner: string, sessionId: string, url = "about:blank", reuseKey?: string, options?: { resume?: boolean; presentation?: BrowserPresentation }) {
  const destination = browserUrl(url);
  const entry = await ensure(owner, sessionId, options?.presentation);
  const opened = entry.openChain.catch(() => {}).then(async () => {
    assertOwner(owner);
    if (entry.closing) throw new Error("浏览器标签页已关闭，请重新打开");
    let tab = reuseKey ? [...entry.tabs.values()].find((t) => t.reuseKey === reuseKey) : undefined;
    if (!tab && entry.nativeWindow) {
      tab = [...entry.tabs.values()].find(t => !t.reuseKey && t.page.url() === "about:blank");
      if (tab) tab.reuseKey = reuseKey;
    }
    if (!tab) tab = await addTab(entry, await entry.context.newPage(), reuseKey);
    if (!(options?.resume && tab.opened && entry.activeTabId && entry.tabs.has(entry.activeTabId))) entry.activeTabId = tab.id;
    entry.error = undefined;
    entry.openRevision = Math.max(Date.now(), (entry.openRevision ?? 0) + 1);
    refreshStreams(entry);
    if (destination !== "about:blank" && !(options?.resume && tab.opened)) {
      await enqueue(tab, async () => { await tab.page.goto(destination, { waitUntil: "domcontentloaded", timeout: 30_000 }); tab.opened = true; });
    }
    if (entry.nativeWindow) await presentBrowser(entry, entry.tabs.get(entry.activeTabId!) ?? tab, options?.presentation ?? entry.presentation!);
    publish(entry);
    return { tabId: tab.id };
  });
  entry.openChain = opened.catch(() => {});
  return opened;
}
async function showWindow(tab: Tab) {
  const { windowId, bounds } = await tab.cdp.send("Browser.getWindowForTarget");
  if (bounds.windowState === "minimized") await tab.cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await tab.page.bringToFront();
}
async function embedTab(entry: Entry, tab: Tab) {
  const size = entry.panelSize ?? { width: 1100, height: 800 };
  await tab.cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
  const { windowId } = await tab.cdp.send("Browser.getWindowForTarget");
  await tab.cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
}
async function presentBrowser(entry: Entry, tab: Tab, presentation: BrowserPresentation) {
  // Changing display mode reuses the very same context, tabs and sign-in.
  entry.presentation = presentation;
  entry.activeTabId = tab.id;
  refreshStreams(entry);
  if (presentation === "window") {
    for (const current of entry.tabs.values()) await current.cdp.send("Emulation.clearDeviceMetricsOverride");
    await showWindow(tab);
  } else {
    for (const current of entry.tabs.values()) await embedTab(entry, current);
  }
  publish(entry);
}
function enqueue<T>(tab: Tab, operation: () => Promise<T>): Promise<T> {
  const task = tab.chain.catch(() => {}).then(operation);
  tab.chain = task.catch(() => {});
  return task;
}
function keyCode(key: string, code: string) {
  const keys: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Meta: 91 };
  return keys[key] ?? (/^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : /^Digit[0-9]$/.test(code) ? code.charCodeAt(5) : 0);
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("浏览器操作参数无效");
  return value;
}
export async function browserAction(owner: string, sessionId: string, action: BrowserAction) {
  assertOwner(owner);
  if (action.action === "open" || action.action === "new-tab") {
    // The panel can remain mounted after its last tab closes. Reopening must
    // retain automation's accepted launcher instead of falling back to headless.
    const presentation = store.entries.get(key(owner, sessionId))?.presentation ?? (sessionId.startsWith("automation:") ? "embedded" : undefined);
    return openBrowser(owner, sessionId, action.url, undefined, { presentation });
  }
  const entry = store.entries.get(key(owner, sessionId));
  const tab = entry?.tabs.get(action.tabId);
  if (!entry || !tab) throw new Error("浏览器标签页已关闭，请重新打开");
  if (entry.presentation === "window" && ["mouse", "key", "text", "resize"].includes(action.action)) throw new Error("请在独立浏览器窗口中直接操作网页");
  if (action.action === "show-window" || action.action === "show-panel") {
    if (!entry.nativeWindow) throw new Error("浏览器操作不支持当前模式");
    const switching = entry.openChain.catch(() => {}).then(async () => {
      assertOwner(owner);
      await presentBrowser(entry, tab, action.action === "show-window" ? "window" : "embedded");
    });
    entry.openChain = switching.catch(() => {});
    await switching; return;
  }
  if (action.action === "select-tab") { entry.activeTabId = tab.id; if (entry.nativeWindow) await presentBrowser(entry, tab, entry.presentation!); refreshStreams(entry); publish(entry); return; }
  return enqueue(tab, async () => {
    assertOwner(owner);
    if (entry.presentation === "window" && ["mouse", "key", "text", "resize"].includes(action.action)) throw new Error("请在独立浏览器窗口中直接操作网页");
    entry.error = undefined;
    switch (action.action) {
      case "close-tab": await tab.page.close(); break;
      case "navigate": await tab.page.goto(browserUrl(action.url), { waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      case "back": await tab.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      case "forward": await tab.page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      case "reload": await tab.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      case "resize": {
        const size = { width: Math.round(finite(action.width, 240, 2560)), height: Math.round(finite(action.height, 180, 1600)) };
        if (entry.presentation === "embedded") {
          entry.panelSize = size;
          await tab.cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
        } else await tab.page.setViewportSize(size);
        break;
      }
      case "mouse": {
        if (!["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"].includes(action.kind) || (action.button && !["left", "right", "middle"].includes(action.button))) throw new Error("鼠标操作无效");
        await tab.cdp.send("Input.dispatchMouseEvent", { type: action.kind, x: finite(action.x, 0, 2560), y: finite(action.y, 0, 1600), button: action.button ?? "left", buttons: finite(action.buttons ?? 0, 0, 7), clickCount: finite(action.clickCount ?? 1, 0, 3), ...(action.kind === "mouseWheel" ? { deltaX: finite(action.deltaX ?? 0, -10000, 10000), deltaY: finite(action.deltaY ?? 0, -10000, 10000) } : {}) });
        break;
      }
      case "key": {
        if (!["keyDown", "keyUp"].includes(action.kind) || typeof action.key !== "string" || action.key.length > 64 || typeof action.code !== "string" || action.code.length > 64) throw new Error("按键操作无效");
        await tab.cdp.send("Input.dispatchKeyEvent", { type: action.kind, key: action.key, code: action.code, windowsVirtualKeyCode: keyCode(action.key, action.code), modifiers: finite(action.modifiers, 0, 15), ...(action.key.length === 1 && !action.modifiers && action.kind === "keyDown" ? { text: action.key } : {}), ...(action.key === "Enter" && action.kind === "keyDown" ? { text: "\r" } : {}) });
        break;
      }
      case "text": if (typeof action.text !== "string" || action.text.length > 50_000) throw new Error("输入文本过长"); await tab.cdp.send("Input.insertText", { text: action.text }); break;
      default: throw new Error("浏览器操作不支持");
    }
    publish(entry);
  });
}
export function subscribeBrowser(owner: string, sessionId: string, listener: Listener, frames = true) {
  assertOwner(owner);
  const id = key(owner, sessionId);
  const listeners = store.listeners.get(id) ?? new Set<Listener>();
  listeners.add(listener); store.listeners.set(id, listeners);
  if (frames) { const viewers = store.viewers.get(id) ?? new Set<Listener>(); viewers.add(listener); store.viewers.set(id, viewers); }
  const entry = store.entries.get(id);
  if (entry) { if (frames && entry.timer) clearTimeout(entry.timer); refreshStreams(entry); }
  listener({ type: "state", state: browserState(owner, sessionId) });
  return () => {
    listeners.delete(listener);
    store.viewers.get(id)?.delete(listener);
    if (!store.viewers.get(id)?.size) store.viewers.delete(id);
    if (!listeners.size) store.listeners.delete(id);
    const current = store.entries.get(id);
    if (current) { refreshStreams(current); scheduleIdle(current); }
  };
}
export async function closeBrowser(owner: string, sessionId: string) {
  const id = key(owner, sessionId);
  const starting = store.starting.get(id);
  if (starting) await starting.catch(() => {});
  const entry = store.entries.get(id);
  if (!entry || entry.closing) return;
  entry.closing = true;
  if (entry.timer) clearTimeout(entry.timer);
  store.entries.delete(id);
  if (entry.nativeWindow) {
    store.nativeWindows?.delete(entry.nativeWindow);
    await entry.nativeWindow.close().catch(() => {});
  } else await entry.context.close().catch(() => {});
  if (!store.entries.size && !store.starting.size) {
    for (const slot of ["browser", "windowBrowser"] as const) {
      const running = store[slot]; store[slot] = undefined;
      void running?.then((browser) => browser.close()).catch(() => {});
    }
  }
  for (const listener of store.listeners.get(id) ?? []) listener({ type: "state", state: browserState(owner, sessionId) });
}
export async function closeSessionBrowsers(sessionId: string) {
  await Promise.all([...store.starting.entries()].filter(([id]) => JSON.parse(id)[1] === sessionId).map(([, pending]) => pending.catch(() => {})));
  await Promise.all([...store.entries.values()].filter((entry) => entry.sessionId === sessionId).map((entry) => closeBrowser(entry.owner, sessionId)));
}
export function clearBrowserIdentity(keepOwner?: string) {
  for (const id of store.starting.keys()) { const [owner, sessionId] = JSON.parse(id); if (owner !== keepOwner) void closeBrowser(owner, sessionId); }
  for (const entry of store.entries.values()) if (entry.owner !== keepOwner) void closeBrowser(entry.owner, entry.sessionId);
}
if (!store.cleanupInstalled) {
  store.cleanupInstalled = true;
  const timer = setInterval(() => clearBrowserIdentity(currentOwner() ?? undefined), 5_000);
  timer.unref?.();
  const shutdown = () => { for (const slot of ["browser", "windowBrowser"] as const) void store[slot]?.then((b) => b.close()).catch(() => {}); };
  process.once("beforeExit", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function hasBrowser(owner: string, sessionId: string) { return store.entries.has(key(owner, sessionId)); }

if (!store.nativeCleanupInstalled) {
  store.nativeCleanupInstalled = true;
  const shutdownWindows = () => { for (const window of store.nativeWindows ?? []) void window.close().catch(() => {}); };
  process.once("SIGTERM", shutdownWindows);
  process.once("SIGINT", shutdownWindows);
  process.once("beforeExit", shutdownWindows);
}
