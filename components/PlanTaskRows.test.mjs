import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { getTaskStatus, PlanTaskRows } = await jiti.import("./PlanTaskRows.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("plan task rows derive status from persisted todo completion and the active stream", () => {
  assert.equal(getTaskStatus({ index: 1, text: "finished", done: true }, 2), "completed");
  assert.equal(getTaskStatus({ index: 2, text: "current", done: false }, 2), "running");
  assert.equal(getTaskStatus({ index: 3, text: "later", done: false }, 2), "pending");
});

test("completed todos take precedence over a stale inferred running index", () => {
  assert.equal(getTaskStatus({ index: 2, text: "already done", done: true }, 2), "completed");
});

test("advances the inferred running row to the first incomplete task", () => {
  const todos = [
    { index: 1, text: "one", done: true },
    { index: 2, text: "two", done: true },
    { index: 3, text: "three", done: false },
  ];
  assert.equal(getTaskStatus(todos[0], 3), "completed");
  assert.equal(getTaskStatus(todos[1], 3), "completed");
  assert.equal(getTaskStatus(todos[2], 3), "running");
});

test("renders Markdown in both compact task titles and expanded details without block or interactive children", () => {
  const text = "**建立访问权限。** 使用 `api_key`，*验证* ~~旧接口~~；[文档](https://example.com)";
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(PlanTaskRows, { todos: [{ index: 1, text, done: false }], isStreaming: true })));
  const button = html.match(/<button[\s\S]*?<\/button>/)?.[0] ?? "";
  const details = html.slice(html.indexOf("grid-template-rows"));
  for (const markup of [button, details]) {
    assert.match(markup, /<strong>建立访问权限。<\/strong>/);
    assert.match(markup, /<code class="markdown-inline-code">api_key<\/code>/);
    assert.match(markup, /<em>验证<\/em>/);
    assert.match(markup, /<del>旧接口<\/del>/);
    assert.match(markup, /文档/);
    assert.doesNotMatch(markup, /<a\b|<img\b/);
  }
  assert.doesNotMatch(button, /<p\b|<div\b/);
  assert.match(button, /truncate/);
  assert.match(details, /whitespace-pre-wrap break-words/);
});
