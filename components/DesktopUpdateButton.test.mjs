import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const css = registerHooks({ load(url, context, next) {
  if (url.endsWith(".module.css")) return { format: "module", source: "export default new Proxy({}, {get:(_,key)=>String(key)})", shortCircuit: true };
  return next(url, context);
} });
after(() => css.deregister());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true,
  alias: { "./ui/dialog": fileURLToPath(new URL("./test-fixtures/update-dialog-ssr.mjs", import.meta.url)) },
});
const { DesktopUpdateContent, DesktopUpdateTrigger } = await jiti.import("./DesktopUpdateButton.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { getLocalePlugin } = await jiti.import("@/lib/i18n/registry");
const initial = { enabled: true, currentVersion: "0.8.8", phase: "idle", version: null, notes: null, downloadedBytes: 0, totalBytes: null, readyToInstall: false, error: null };
const render = (state, extra = {}) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(DesktopUpdateContent, {
  view: { host: true, state: { ...initial, ...state }, loading: false, pending: null, error: null, failedAction: null, ...extra }, run() {}, close() {},
})));
const renderTrigger = (state, extra = {}) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(DesktopUpdateTrigger, {
  view: { host: true, state: { ...initial, ...state }, loading: false, pending: null, error: null, failedAction: null, ...extra }, onClick() {},
})));

test("the rail button is hidden until a newer enabled desktop release is known", () => {
  for (const state of [{}, { phase: "checking" }, { phase: "upToDate" }, { phase: "error" }, { version: "0.8.8" }, { version: "0.8.7" }, { version: "0.8.9", enabled: false }]) {
    assert.doesNotMatch(renderTrigger(state), /data-desktop-update-trigger/);
  }
  assert.doesNotMatch(renderTrigger({ version: "0.8.9" }, { host: false }), /data-desktop-update-trigger/);
  assert.match(renderTrigger({ phase: "available", version: "0.8.9" }), /aria-label="Download version 0.8.9"/);
});

test("the rail button exposes download progress and the explicit quit-and-update action", () => {
  const progress = renderTrigger({ phase: "downloading", version: "0.8.9", downloadedBytes: 50, totalBytes: 100 });
  assert.match(progress, /aria-label="Downloading update… 50%"/);
  assert.match(progress, /aria-busy="true"/);
  const ready = renderTrigger({ phase: "downloaded", version: "0.8.9", readyToInstall: true });
  assert.match(ready, /aria-label="Close Eureka and update to 0.8.9"/);
});

test("download progress is accessible and never presents an install action before verification", () => {
  const html = render({ phase: "downloading", version: "0.8.9", downloadedBytes: 50, totalBytes: 100 });
  assert.match(html, /role="progressbar"/); assert.match(html, /aria-valuenow="50"/);
  assert.doesNotMatch(html, />Close Eureka and update</);
  assert.match(html, /continue in the background/);
});
test("a verified update presents explicit installation and retains busy-task retry guidance", () => {
  const html = render({ phase: "error", version: "0.8.9", readyToInstall: true }, { error: "仍有聊天或自动化任务正在运行", failedAction: "install" });
  assert.match(html, />Close Eureka and update</); assert.match(html, /role="alert"/);
  assert.match(html, /Finish it before installing/); assert.doesNotMatch(html, />Download again</);
});
test("development status explains the restriction and offers no update action", () => {
  const html = render({ phase: "disabled", enabled: false });
  assert.match(html, /Development version/); assert.doesNotMatch(html, />Check for updates</);
});
test("update UI has matching Chinese and English translations", () => {
  const en = getLocalePlugin("en").messages, zh = getLocalePlugin("zh-CN").messages;
  const keys = Object.keys(en).filter(key => key.startsWith("updates."));
  assert.ok(keys.length > 20);
  assert.deepEqual(keys.sort(), Object.keys(zh).filter(key => key.startsWith("updates.")).sort());
  for (const key of keys) assert.deepEqual([...en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]), [...zh[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]), key);
});
