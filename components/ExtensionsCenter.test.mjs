import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/InstalledCapabilitiesSidebar.module.css")) {
      return { format: "module", source: "export default new Proxy({}, { get: (_, name) => String(name) });", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
after(() => cssHook.deregister());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ExtensionsCenter } = await jiti.import("./ExtensionsCenter.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const render = (guest) => renderToStaticMarkup(React.createElement(I18nProvider, null,
  React.createElement(ExtensionsCenter, { guest, cwd: "E:/example", sessionId: null, onOpenExtensionDetails() {} })));

test("guests start in the ordinary marketplace and enterprise content is not rendered", () => {
  const html = render(true);
  assert.match(html, /<button(?=[^>]*aria-label="Extension source")(?=[^>]*aria-haspopup="menu")[^>]*><span[^>]*>Marketplace extensions<\/span>/);
  assert.match(html, /role="region" aria-label="Marketplace extensions · Skills · Marketplace"/);
  assert.match(html, /role="tablist"[^>]*aria-label="Installation scope"/);
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Global<\/button>/);
  assert.doesNotMatch(html.slice(html.indexOf("</aside>")), /role="tab"/);
  assert.match(html, />Plugins<\/button>/);
  assert.doesNotMatch(html, /Loading organization extensions|Organization skills|organization-extension-card/);
});

test("logged-in accounts start with organization content and categories live in the sidebar", () => {
  const html = render(false);
  assert.match(html, /<aside[\s\S]*?<button(?=[^>]*aria-label="Extension source")[^>]*><span[^>]*>Organization extensions<\/span>/);
  assert.match(html, /<nav[^>]*aria-label="Capability type"[\s\S]*?>Plugins<\/button>[\s\S]*?>Skills<\/button>[\s\S]*?>MCP<\/button>[\s\S]*?<\/nav>/);
  assert.match(html, /Loading organization extensions/);
  assert.equal((html.match(/>Plugins<\/button>/g) ?? []).length, 1, "no duplicate category navigation in the content header");
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="false")[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Project<\/button>/);
  assert.doesNotMatch(html.slice(html.indexOf("</aside>")), /role="tab"/, "catalog and management navigation belongs to the sidebar");
});
