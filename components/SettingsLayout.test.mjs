import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SettingsLayout, SettingsSection, SettingsCard, SettingsRow } = await jiti.import("./SettingsLayout.tsx");

test("settings retain one page heading, an optional action and accessible section metadata", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsLayout, {
    title: "Models", description: "Manage models", actions: React.createElement("button", null, "Add provider"),
  }, React.createElement(SettingsSection, {
    title: "Providers", titleId: "providers-title", description: "Connected accounts", descriptionId: "providers-description", meta: "2 connected",
  }, React.createElement(SettingsCard, { "aria-busy": true }, "Loading"))));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Models<\/h1>/);
  assert.match(html, /<button>Add provider<\/button>/);
  assert.match(html, /<section aria-labelledby="providers-title"/);
  assert.match(html, /id="providers-description"/);
  assert.match(html, /2 connected/);
  assert.match(html, /data-slot="settings-card"[^>]*aria-busy="true"/);
});

test("settings rows preserve label and description associations for their controls", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsRow, {
    label: "Completion sound", description: "Play a sound", htmlFor: "sound", descriptionId: "sound-description",
  }, React.createElement("input", { id: "sound", type: "checkbox", "aria-describedby": "sound-description" })));
  assert.match(html, /<label[^>]*for="sound"[^>]*>Completion sound<\/label>/);
  assert.match(html, /<p id="sound-description"/);
  assert.match(html, /aria-describedby="sound-description"/);
});

test("usage statistics uses the shared page and card surfaces while loading", async () => {
  const { UsageStatisticsPage } = await jiti.import("./UsageStatistics.tsx");
  const { I18nProvider } = await jiti.import("@/hooks/useI18n");
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(UsageStatisticsPage)));
  assert.equal((html.match(/data-slot="settings-layout"/g) ?? []).length, 1);
  assert.equal((html.match(/data-slot="settings-card"/g) ?? []).length, 4);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
});
