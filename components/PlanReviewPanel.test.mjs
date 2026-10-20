import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { PlanReviewPanel } = await jiti.import("./PlanReviewPanel.tsx");
const { InlineMarkdown } = await jiti.import("./InlineMarkdown.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { EMPTY_PLAN_STATE, parsePlanTodos } = await jiti.import("@/lib/plan-mode");

test("review progress renders persisted Markdown without altering task text or completion state", () => {
  const content = "## 目标\n\n建立接口\n\n## 实施步骤\n\n- [x] **建立访问权限。** 使用 `api_key`\n- [ ] *验证请求*，~~移除旧接口~~\n\n## 验证\n\n- [ ] 完成测试";
  const todos = parsePlanTodos(content);
  const plan = { ...EMPTY_PLAN_STATE, phase: "reviewing", content, todos };
  const snapshot = JSON.stringify(plan);
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(PlanReviewPanel, {
      plan, onClose() {}, onUpdate() {}, onReturnForRevision() {}, onApprove() {}, onAbandon() {},
    })));
  const progress = html.slice(html.lastIndexOf('<section'));
  assert.match(progress, /1\/3/);
  assert.match(progress, /<strong>建立访问权限。<\/strong>/);
  assert.match(progress, /<code class="markdown-inline-code">api_key<\/code>/);
  assert.match(progress, /<em>验证请求<\/em>/);
  assert.match(progress, /<del>移除旧接口<\/del>/);
  assert.equal((progress.match(/role="checkbox"/g) ?? []).length, 3);
  assert.equal((progress.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.match(progress, /line-through opacity-70/);
  assert.equal(JSON.stringify(plan), snapshot);
});

test("compact Markdown keeps literal code and escapes intact while excluding HTML and nested controls", () => {
  const html = renderToStaticMarkup(React.createElement(InlineMarkdown, null,
    '`**literal**` \\*escaped\\* [docs](https://example.com) ![image](https://example.com/a.png) <button>unsafe</button> <script>alert(1)</script>'));
  assert.match(html, /<code class="markdown-inline-code">\*\*literal\*\*<\/code>/);
  assert.match(html, /\*escaped\*/);
  assert.match(html, /docs/);
  assert.doesNotMatch(html, /<button\b|<a\b|<img\b|<script\b|<p\b|<div\b/);
});
