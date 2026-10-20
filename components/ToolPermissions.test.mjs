import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { DefaultToolPermissionsSettings } = await jiti.import("./ToolPermissions.tsx");
const render = (element) => renderToStaticMarkup(React.createElement(I18nProvider, null, element));

test("settings distinguish new-session defaults from existing session permissions", () => {
  const html = render(React.createElement(DefaultToolPermissionsSettings));
  assert.match(html, /Default tool permissions for new sessions/);
  assert.match(html, /Existing sessions keep their permissions/);
  assert.match(html, /<button[^>]+aria-label="Default tool permissions for new sessions"/);
  assert.match(html, />Default<\/span>/);
  assert.doesNotMatch(html, /type="radio"|<fieldset/);
});

test("permissions are published by the active session to both top-menu variants, not the composer", async () => {
  const [shell, chat, composer, hook] = await Promise.all([
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /activeSessionIdRef\.current === sessionId/);
  assert.match(shell, /toolPermissionControls\?\.sessionId === selectedSession\?\.id/);
  assert.match(shell, /<SessionToolPermissionsMenu key=\{selectedSession\?\.id\}/);
  assert.match(shell, /<SessionToolPermissionsButton key=\{selectedSession\.id\}/);
  assert.match(chat, /busy: sessionBusy \|\| isCompacting/);
  assert.match(chat, /locked: planMode\.planModeActive \|\| planMode\.phase === "executing"/);
  assert.doesNotMatch(composer, /value="tool-permissions"|toolPermissionsOpen/);
  const change = hook.slice(hook.indexOf("  const handleToolPresetChange"), hook.indexOf("  const loadToolPermissions"));
  assert.doesNotMatch(change, /setPreferredToolPreset/);
  assert.ok(change.indexOf('type: "set_tools"') < change.indexOf("setToolPresetState(preset)"));
  assert.match(change, /sessionHookMountedRef\.current/);
  assert.match(hook, /if \(!sessionIdRef\.current && !ensuringNewSessionRef\.current\)/);
});
