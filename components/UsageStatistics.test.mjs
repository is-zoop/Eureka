import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { Heatmap, TokenTrend } = await jiti.import("./UsageStatistics.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const render = element => renderToStaticMarkup(React.createElement(I18nProvider, null, element));
const totals = { input: 20, output: 30, cacheRead: 50, cacheWrite: 0, total: 100, cost: 0.25, calls: 1, usageCalls: 1, costCalls: 1, sessions: 1, activeDays: 1, toolCalls: 0, cacheHitRate: 0.5 };
const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

test("fitting the activity calendar retains every day and accessible usage details", () => {
  const html = render(React.createElement(Heatmap, { days: [{ ...totals, date }] }));
  const buttonCount = (html.match(/<button\b/g) ?? []).length;
  assert.ok(buttonCount >= 365 && buttonCount <= 373, `Expected a full year, got ${buttonCount} days`);
  assert.match(html, /Total tokens: 100/);
  assert.match(html, /Input: 20/);
  assert.match(html, /Output: 30/);
  assert.match(html, /Cache read: 50/);
  assert.match(html, /Calls: 1/);
});

test("monthly bars retain all months and preserve the selected range totals", () => {
  const days = [{ ...totals, date }];
  const html = render(React.createElement(TokenTrend, { days, range: "12m" }));
  assert.equal((html.match(/<button\b/g) ?? []).length, 13);
  assert.match(html, /: 100"/);
  const allTime = render(React.createElement(TokenTrend, { days, range: "all" }));
  assert.equal((allTime.match(/<button\b/g) ?? []).length, 1);
  assert.match(allTime, /: 100"/);
});

test("an empty activity calendar still exposes the full date range", () => {
  const html = render(React.createElement(Heatmap, { days: [] }));
  assert.ok((html.match(/<button\b/g) ?? []).length >= 365);
  assert.match(html, /Total tokens: 0/);
});
