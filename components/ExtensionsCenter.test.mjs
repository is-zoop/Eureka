import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ExtensionsCenter } = await jiti.import("./ExtensionsCenter.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const render = (guest) => renderToStaticMarkup(React.createElement(I18nProvider, null,
  React.createElement(ExtensionsCenter, { guest, cwd: "E:/example", sessionId: null, onOpenExtensionDetails() {} })));

test("guests start in the ordinary marketplace and enterprise content is not rendered", () => {
  const html = render(true);
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*disabled="")(?=[^>]*title="Log in to use enterprise extensions")[^>]*>Organization extensions<\/button>/);
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*>Marketplace extensions<\/button>/);
  assert.match(html, />Plugins<\/button>/);
  assert.doesNotMatch(html, /Loading organization extensions|Organization skills|organization-extension-card/);
});

test("logged-in accounts keep the existing organization landing tab", () => {
  const html = render(false);
  assert.match(html, /<button(?=[^>]*role="tab")(?=[^>]*aria-selected="true")[^>]*>Organization extensions<\/button>/);
  assert.match(html, /Loading organization extensions/);
  assert.equal((html.match(/>Plugins<\/button>/g) ?? []).length, 1, "the selected organization group exposes its plugin category");
});
