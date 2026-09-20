import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { Alert, AlertTitle, AlertDescription, AlertAction } = await jiti.import("./ui/alert.tsx");
const { NotificationNotice } = await jiti.import("./Notifications.tsx");
const source = await readFile(new URL("./Notifications.tsx", import.meta.url), "utf8");

test("state feedback reserves no space in its originating page", () => {
  for (const type of ["error", "warning", "info", "success"]) {
    assert.equal(renderToStaticMarkup(React.createElement(NotificationNotice, { message: "Result", type })), "");
  }
});

test("Alert composition supports wrapping, escaped error text and an accessible close action", () => {
  const html = renderToStaticMarkup(React.createElement(Alert, { variant: "destructive" },
    React.createElement(AlertTitle, null, "错误"),
    React.createElement(AlertDescription, null, "Request failed\n<script>unsafe</script>"),
    React.createElement(AlertAction, null, React.createElement("button", { type: "button", "aria-label": "关闭通知" }, "×"))));
  assert.match(html, /role="alert"/);
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /aria-label="关闭通知"/);
});

test("each floating Alert auto-dismisses after three seconds and restarts its timer after hover", () => {
  const card = source.slice(source.indexOf("function NotificationCard"));
  assert.match(source, /const AUTO_DISMISS_MS = 3_000/);
  assert.match(card, /setTimeout\(\(\) => dismiss\(item\.id\), AUTO_DISMISS_MS\)/);
  assert.match(card, /onMouseEnter=\{clearTimer\}/);
  assert.match(card, /onMouseLeave=\{startTimer\}/);
  assert.match(card, /useEffect\(\(\) => \{\s*startTimer\(\);[\s\S]*?return clearTimer;/);
});
