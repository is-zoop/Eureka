import assert from "node:assert/strict";
import test from "node:test";
import { getDesktopShortcut, getDesktopEditShortcut, publishDesktopMenuContext, getDesktopMenuContext, subscribeDesktopMenuContext, EMPTY_DESKTOP_MENU_CONTEXT, isDesktopMenuId } from "./desktop-menu.ts";

const key = (key, extra = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra });
test("desktop shortcuts distinguish global actions from native text editing", () => {
  for (const [event, command] of [[key("n", { altKey: true }), "new-task"], [key("b"), "toggle-sidebar"], [key("b", { shiftKey: true }), "toggle-files"], [key(","), "settings"], [key("+", { shiftKey: true }), "zoom-in"], [key("="), "zoom-in"], [key("-"), "zoom-out"], [key("0"), "zoom-reset"], [key("F11", { ctrlKey: false }), "fullscreen"]]) assert.equal(getDesktopShortcut(event), command);
  for (const event of [key("c"), key("v"), key("z"), key("a"), key("n"), key("b", { altKey: true }), key("b", { metaKey: true }), key("F11")]) assert.equal(getDesktopShortcut(event), null);
  assert.equal(getDesktopEditShortcut(key("z")), "undo");
  assert.equal(getDesktopEditShortcut(key("z", { shiftKey: true })), "redo");
  assert.equal(getDesktopEditShortcut(key("v")), "paste");
  assert.equal(getDesktopEditShortcut(key("c", { shiftKey: true })), null);
});

test("menu context publishes the current workspace and clears on unmount", () => {
  let count = 0;
  const unsubscribe = subscribeDesktopMenuContext(() => count++);
  const context = { ready: true, cwd: "E:\\Eureka", authenticated: true, projects: ["E:\\Eureka"] };
  publishDesktopMenuContext(context);
  assert.equal(getDesktopMenuContext(), context);
  publishDesktopMenuContext(EMPTY_DESKTOP_MENU_CONTEXT);
  assert.equal(getDesktopMenuContext().ready, false);
  assert.equal(count, 2);
  unsubscribe();
  publishDesktopMenuContext(EMPTY_DESKTOP_MENU_CONTEXT);
  assert.equal(count, 2);
  assert.equal(isDesktopMenuId("edit"), true);
  assert.equal(isDesktopMenuId("arbitrary"), false);
});
