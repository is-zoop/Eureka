import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/ContextPopover.module.css")) return { format: "module", source: "export default new Proxy({}, { get: (_, name) => String(name) });", shortCircuit: true };
    return nextLoad(url, context);
  },
});
after(() => cssHook.deregister());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ContextInspector, ContextPopover } = await jiti.import("./ContextPopover.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const stats = { sessionId: "fixture", sessionName: "Private session name", sessionFile: "C:\\fixture\\session.jsonl", totalActiveMs: 107000, userMessages: 3, assistantMessages: 16, toolCalls: 20, toolResults: 20, totalMessages: 39, tokens: { input: 43551, output: 1665, cacheRead: 86016, cacheWrite: 0, total: 131232 }, cost: .1124 };
const render = (props = {}) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ContextInspector, {
  details: null, stats, usage: { tokens: 60000, contextWindow: 200000, percent: 30 }, controls: null, tab: "context", onTabChange: () => {}, ...props,
})));

test("context tab shows current capacity and hides cumulative usage and identity metadata", () => {
  const html = render();
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"[^>]*>Context</);
  assert.match(html, /30%/);
  assert.match(html, /60k/);
  assert.match(html, /200k/);
  assert.doesNotMatch(html, /131,232|\$0\.1124|Private session name|session\.jsonl|Active time/);
});

test("session tab shows cumulative usage and message counts without session identity", () => {
  const html = render({ tab: "session" });
  assert.match(html, /aria-selected="true"[^>]*>Session</);
  for (const value of ["131,232", "$0.1124", "66.4%", "Messages", "Tool Calls", "Tool Results"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Private session name|session\.jsonl|1m 47s|Compact now|capacityBar/);
});

test("unknown capacity is not converted into a fabricated percentage", () => {
  const html = render({ usage: { tokens: 15700, contextWindow: 0, percent: null } });
  assert.match(html, /15\.7k/);
  assert.match(html, /Context limit unavailable/);
  assert.doesNotMatch(html, /NaN%|Infinity|0%/);
});

test("busy context preserves its manual compaction guard", () => {
  const html = render({ details: { sessionId: "fixture", source: "live", usage: { tokens: 60000, contextWindow: 200000, percent: 30 }, breakdown: [], reserveTokens: 1000, canCompact: true, autoCompactionEnabled: true }, controls: { sessionId: "fixture", busy: true, isCompacting: false, compact() {}, abort() {}, error: null, result: null } });
  assert.match(html, /disabled=""[^>]*>Compact now</);
});

test("composer trigger remains disabled before a session exists", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(ContextPopover, {
    sessionId: null, leafId: null, stats: null, usage: null, controls: null, open: true, onOpenChange: () => {},
  })));
  assert.match(html, /data-context-trigger/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-context-popup/);
});
