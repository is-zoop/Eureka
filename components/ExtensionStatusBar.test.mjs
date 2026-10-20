import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ExtensionStatusBar,
  formatExtensionStatusLine,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { McpStatusDetails } = await jiti.import("./McpStatusPopover.tsx");

function renderStatusBar(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionStatusBar, props),
    ),
  );
}

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("sanitizes status text for a single-line display", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second third",
  );
});

test("renders a single status line without identifier keys", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
      { key: "05-ponytail", text: "ponytail" },
    ],
  });

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /extension-status-shelf/);
  assert.match(html, /extension-status-line/);
  assert.match(html, /extension-status-text/);
  assert.match(html, />ponytail <\/span>/);
  assert.match(html, />memory</);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
});

test("renders widgets and status text in one footer", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-status-shelf has-widgets has-status/);
  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  assert.match(html, /connected/);
});

test("only the MCP footer entry opens session status while other extensions stay ordinary text", () => {
  const html = renderStatusBar({ sessionId: "session-a", statuses: [
    { key: "mcp", text: "MCP: 1 server enabled" },
    { key: "other", text: "Other extension" },
  ] });
  assert.match(html, /<button[^>]+aria-label="View current session MCP status"/);
  assert.match(html, /MCP: 1 server enabled/);
  assert.match(html, /Other extension/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  const noSession = renderStatusBar({ statuses: [{ key: "mcp", text: "MCP" }] });
  assert.match(noSession, /<button[^>]+disabled/);
});

test("MCP details distinguish enabled, connected, cached and authentication states", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(McpStatusDetails, { status: {
    sessionId: "session-a", updatedAt: "2026-10-20T00:00:00Z", totalTools: 9, totalResources: 2,
    servers: [
      { name: "atlas", state: "connected", disabled: false, toolCount: 7, directToolCount: 2, resourceCount: 2, listenState: "active", catalogStale: true },
      { name: "lazy", state: "cached", disabled: false, toolCount: 2 },
      { name: "protected", state: "needs-auth", disabled: false, toolCount: 0 },
      { name: "broken", state: "failed", disabled: false, toolCount: 0, failedAgoSeconds: 15 },
      { name: "off", state: "disabled", disabled: true, toolCount: 0 },
    ],
  } })));
  assert.match(html, /Catalog cached/);
  assert.match(html, /Needs authentication/);
  assert.match(html, /Listening/);
  assert.match(html, /Direct tools/);
  assert.match(html, /failed 15 seconds earlier/);
  assert.match(html, /no detailed error text/);
  assert.match(html, /not been synchronized/);
  assert.match(html, /—/);
  assert.doesNotMatch(html, /mcpStatus\./);
});
