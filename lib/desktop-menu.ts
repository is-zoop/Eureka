export const DESKTOP_MENU_OPEN_EVENT = "eureka:desktop-menu-open";
export const DESKTOP_MENU_ACTION_EVENT = "eureka:desktop-menu-action";
export const DESKTOP_MENU_COMMAND_EVENT = "eureka:desktop-menu-command";

export const DESKTOP_MENU_IDS = ["file", "edit", "view", "help"] as const;
export type DesktopMenuId = typeof DESKTOP_MENU_IDS[number];
export type DesktopMenuCommand = "new-task" | "select-project" | "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" | "settings" | "toggle-sidebar" | "toggle-files" | "zoom-in" | "zoom-out" | "zoom-reset" | "fullscreen" | "logout" | "quit" | "about";
export type DesktopMenuRequest = { command: DesktopMenuCommand; path?: string };
export type DesktopMenuContext = { ready: boolean; cwd: string | null; authenticated: boolean; projects: string[] };

export const EMPTY_DESKTOP_MENU_CONTEXT: DesktopMenuContext = { ready: false, cwd: null, authenticated: false, projects: [] };
let context = EMPTY_DESKTOP_MENU_CONTEXT;
const listeners = new Set<() => void>();

export function getDesktopMenuContext() { return context; }
export function subscribeDesktopMenuContext(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishDesktopMenuContext(next: DesktopMenuContext) {
  context = next;
  listeners.forEach((listener) => listener());
}

export function isDesktopMenuId(value: unknown): value is DesktopMenuId {
  return DESKTOP_MENU_IDS.some((id) => id === value);
}

export function dispatchDesktopMenuCommand(request: DesktopMenuRequest) {
  window.dispatchEvent(new CustomEvent(DESKTOP_MENU_COMMAND_EVENT, { detail: request }));
}

export function getDesktopShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): DesktopMenuCommand | null {
  const key = event.key.toLowerCase();
  if (event.metaKey) return null;
  if (key === "f11" && !event.ctrlKey && !event.altKey && !event.shiftKey) return "fullscreen";
  if (!event.ctrlKey) return null;
  if (event.altKey) return key === "n" && !event.shiftKey ? "new-task" : null;
  if (key === "b") return event.shiftKey ? "toggle-files" : "toggle-sidebar";
  if (key === "," && !event.shiftKey) return "settings";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  if (key === "0" && !event.shiftKey) return "zoom-reset";
  return null;
}

export function getDesktopEditShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): DesktopMenuCommand | null {
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (event.shiftKey) return null;
  return ({ y: "redo", x: "cut", c: "copy", v: "paste", a: "select-all" } as Record<string, DesktopMenuCommand>)[key] ?? null;
}
