import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MermaidBlock, CodeBlock, parseUnifiedDiff } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

function renderCode(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(CodeBlock, props),
    ),
  );
}

test("CodeBlock highlights code when not streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript" });

  assert.match(html, /class="token/);
  assert.match(html, /const/);
});

test("CodeBlock renders plain text without tokenization while streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript", isStreaming: true });

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /const x = 1;/);
});

test("CodeBlock renders a valid diff in Diff view by default", () => {
  const source = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 export const value = 1;
-export const oldName = "old";
+export const newName = "new";
+export const extra = true;`;
  const html = renderCode({ code: source, lang: "diff" });

  assert.match(html, /markdown-diff-body/);
  assert.match(html, /\+2/);
  assert.match(html, /−1/);
  assert.match(html, />Code</);
  assert.match(html, />Diff</);
  assert.match(html, /newName/);
});

test("CodeBlock falls back to a normal code view for invalid diffs", () => {
  const html = renderCode({ code: "not a unified patch", lang: "patch" });

  assert.doesNotMatch(html, /markdown-diff-body/);
  assert.match(html, /not a unified patch/);
  assert.doesNotMatch(html, />Diff</);
});

test("parseUnifiedDiff preserves old and new line numbers across hunks", () => {
  const parsed = parseUnifiedDiff(`@@ -4,2 +4,3 @@
 keep
-old
+new
+added
@@ -20 +21 @@
-gone
+replacement`);

  assert.equal(parsed?.added, 3);
  assert.equal(parsed?.removed, 2);
  assert.deepEqual(parsed?.rows.map((row) => [row.kind, row.oldLine, row.newLine]), [
    ["context", 4, 4],
    ["delete", 5, null],
    ["add", null, 5],
    ["add", null, 6],
    ["delete", 20, null],
    ["add", null, 21],
  ]);
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderMermaid({ code: chineseMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});
