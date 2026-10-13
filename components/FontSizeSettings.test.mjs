import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { FontSizeSettings } = await jiti.import("./FontSizeSettings.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("offers borderless size choices with small selected and a reading preview", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(FontSizeSettings)));
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-labelledby="font-size-label"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.match(html, /<button(?=[^>]*id="font-size-small")(?=[^>]*role="radio")(?=[^>]*aria-checked="true")[^>]*>/);
  assert.doesNotMatch(html, /data-slot="radio-group-item"/);
  assert.match(html, />Small<\/span>/);
  assert.match(html, />Medium<\/span>/);
  assert.match(html, />Large<\/span>/);
  assert.match(html, /class="markdown-body"/);
});
