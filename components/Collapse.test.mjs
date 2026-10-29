import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { Collapse } = await jiti.import("./Collapse.tsx");

test("closed heavy details remain lazy and are excluded from focus and accessibility", () => {
  let rendered = false;
  const html = renderToStaticMarkup(React.createElement(Collapse, { open: false }, () => {
    rendered = true;
    return React.createElement("button", null, "Heavy content");
  }));
  assert.equal(rendered, false);
  assert.doesNotMatch(html, /Heavy content/);
  assert.match(html, /grid-template-rows:0fr/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /inert=""/);
});

test("initially open details retain their content and are accessible", () => {
  const html = renderToStaticMarkup(React.createElement(Collapse, { open: true }, React.createElement("a", { href: "/file" }, "Open file")));
  assert.match(html, /Open file/);
  assert.match(html, /grid-template-rows:1fr/);
  assert.match(html, /aria-hidden="false"/);
  assert.doesNotMatch(html, /inert=/);
});

test("lightweight task descriptions can stay mounted while remaining inert", () => {
  const html = renderToStaticMarkup(React.createElement(Collapse, { open: false, keepMounted: true }, "Task description"));
  assert.match(html, /Task description/);
  assert.match(html, /grid-template-rows:0fr/);
  assert.match(html, /inert=""/);
});
