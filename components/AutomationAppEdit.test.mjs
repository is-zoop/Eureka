import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true,
  alias: { "./ui/dialog": fileURLToPath(new URL("./test-fixtures/dialog-ssr.mjs", import.meta.url)) },
});
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { AutomationAppEdit } = await jiti.import("./AutomationAppEdit.tsx");
const { getLocalePlugin } = await jiti.import("@/lib/i18n/registry");

test("edit dialog has exactly the requested five fields, associated labels and no extra description", () => {
  const detail = { install: { id: "c9677b6a-7991-4fc1-8d40-8862c3c9dcab", revision: 2 }, manifest: { displayName: "Text tools", description: "Processes text" } };
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(AutomationAppEdit, { detail, index: { ownerKey: "owner", runtimeId: "runtime" }, active: true, onSaved() {}, onClose() {} })));
  assert.equal((html.match(/data-slot="field-label"/g) ?? []).length, 5);
  for (const id of ["name", "icon", "category", "tags", "description"]) assert.match(html, new RegExp(`for="app-edit-${id}"`));
  assert.match(html, /Edit application/); assert.match(html, /Description/); assert.match(html, /Capability tags/);
  assert.doesNotMatch(html, /field-description|Slug|Quick start|Publish to Haze|AI/);
  assert.match(html, /id="app-edit-icon"[^>]*type="button"|type="button"[^>]*id="app-edit-icon"/);
  assert.match(html, /form="automation-edit-app"[^>]*disabled|disabled[^>]*form="automation-edit-app"/);
});

test("new editor labels exist in both built-in languages", () => {
  for (const locale of ["en", "zh-CN"]) for (const key of ["automationUi.editApp", "appEdit.icon", "appEdit.removeIcon", "appEdit.description"]) assert.ok(getLocalePlugin(locale).messages[key]);
});
