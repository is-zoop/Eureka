import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createJiti } from "jiti";

const cssHook = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".module.css")) return { format: "module", source: "export default new Proxy({}, { get: (_, name) => String(name) });", shortCircuit: true };
  return nextLoad(url, context);
} });
after(() => cssHook.deregister());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: false,
  alias: {
    "@/components/ui/dialog": fileURLToPath(new URL("../fixtures/dialog-ssr.mjs", import.meta.url)),
    "@": fileURLToPath(new URL("../../", import.meta.url)),
  },
});
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { getLocalePlugin } = await jiti.import("@/lib/i18n/registry");
const { interpolateMessage } = await jiti.import("@/lib/i18n/format");
const { AutomationWorkspace } = await jiti.import("../../features/automation/ui/AutomationWorkspace.tsx");
const { AutomationStartPage } = await jiti.import("../../features/automation/ui/AutomationStartPage.tsx");
const { AutomationAppDetails } = await jiti.import("../../features/automation/ui/AutomationAppDetails.tsx");
const { AutomationApplication } = await jiti.import("../../features/automation/ui/AutomationApplication.tsx");
const { RemovalDialog } = await jiti.import("../../features/extensions/ui/RemovalDialog.tsx");
const render = component => renderToStaticMarkup(React.createElement(I18nProvider, null, component));
const noop = () => {};
const index = { ownerKey: "owner", runtimeId: "runtime", apps: [], data: [] };
const detail = {
  manifest: { name: "example", displayName: "Example app", version: "1.0.0", description: "User description", automation: { capabilities: ["files.read"] } },
  install: { id: "example", revision: 1, disabled: false, updatedAt: "2026-11-03T00:00:00Z" },
  workflow: { nodes: [], edges: [] }, ui: { fields: [], buttons: [{ id: "run", label: "Run", action: "run", nodeId: "fixture" }], results: { columns: [] } },
  files: [], readme: "", codeDirectory: "/apps/example", dataDirectory: "/data/example",
};

test("automation host UI has complete bilingual keys and matching parameters", () => {
  const en = getLocalePlugin("en").messages, zh = getLocalePlugin("zh-CN").messages;
  const keys = Object.keys(en).filter(key => key.startsWith("automationUi."));
  assert.ok(keys.length > 0);
  assert.deepEqual(keys.sort(), Object.keys(zh).filter(key => key.startsWith("automationUi.")).sort());
  for (const key of keys) {
    assert.ok(en[key].trim(), key); assert.ok(zh[key].trim(), key);
    assert.doesNotMatch(en[key], /\p{Script=Han}/u, key);
    assert.deepEqual((en[key].match(/\{[\w.-]+\}/g) ?? []).sort(), (zh[key].match(/\{[\w.-]+\}/g) ?? []).sort(), key);
  }
  for (const locale of [en, zh]) {
    assert.equal(locale["automationUi.emptyCreateHint"].split("{action}").length, 2);
    assert.equal(locale["automationUi.emptyMarketHint"].split("{action}").length, 2);
    assert.ok(interpolateMessage(locale["automationUi.deletePrompt"], { name: "My app" }).includes("My app"));
  }
});

test("automation components do not introduce untranslated Chinese host labels", () => {
  const automationUi = new URL("../../features/automation/ui/", import.meta.url);
  const files = readdirSync(automationUi)
    .filter(file => /^Automation.*\.tsx$/.test(file))
    .map(file => new URL(file, automationUi));
  assert.ok(files.length > 0);
  files.push(
    new URL("../../features/settings/ui/AutomationSettings.tsx", import.meta.url),
    new URL("../../features/extensions/ui/RemovalDialog.tsx", import.meta.url),
  );
  for (const file of files) {
    const source = ts.createSourceFile(fileURLToPath(file), readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        assert.doesNotMatch(node.text, /\p{Script=Han}/u, `${file}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test("English sidebar uses a short market label and keeps the full accessible name", () => {
  const html = render(React.createElement(AutomationWorkspace, { active: false, guest: false, onOpenMarket: noop, onOpenBrowser: noop, onOpenDetails: noop, onCloseDetails: noop }));
  assert.match(html, />Automation<\/h2>/);
  assert.match(html, /aria-label="Marketplace apps"/);
  assert.match(html, />Market<\/button>/);
  assert.doesNotMatch(html, /\p{Script=Han}/u);
});

test("English start, details, runtime and removal use translated host text while preserving user content", () => {
  const start = render(React.createElement(AutomationStartPage, { apps: [], loading: false, importDisabled: false, onCreate: noop, onImport: noop, onOpen: noop }));
  assert.match(start, /Create automation/); assert.doesNotMatch(start, /Frequently used apps/);
  const details = render(React.createElement(AutomationAppDetails, { request: { detail, index, onChanged: noop }, onClose: noop, onInstalledChange: noop }));
  assert.match(details, /Basic information/); assert.match(details, /User description/);
  const runtime = render(React.createElement(AutomationApplication, { detail, index, active: false }));
  assert.match(runtime, /Workflow/); assert.match(runtime, /No results yet/);
  const removal = render(React.createElement(RemovalDialog, { open: true, name: "我的应用", allowDeleteData: true, onClose: noop, onConfirm: async () => true }));
  assert.match(removal, /Also delete user data/); assert.match(removal, /我的应用/);
  for (const html of [start, details, runtime, removal.replaceAll("我的应用", "")]) assert.doesNotMatch(html, /\p{Script=Han}/u);
});
