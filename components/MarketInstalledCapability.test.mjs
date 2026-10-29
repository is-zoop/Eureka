import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MarketPluginManagement, MarketSkillManagement } = await jiti.import("./MarketInstalledCapability.tsx");
const { CapabilityInstallRuntime } = await jiti.import("./CapabilityInstallRuntime.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const render = (Component, props) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Component, props)));
const plugin = { packageName: "billion-context", source: "npm:billion-context", scope: "global", disabled: false, status: "installed", version: "0.1.208", counts: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, resources: [] };
const skill = { name: "agent-browser", description: "Browser automation instructions", filePath: "E:/project/.agents/skills/agent-browser/SKILL.md", sourceInfo: { scope: "project" }, disableModelInvocation: false, install: { scope: "project", package: "vercel-labs/agent-browser@agent-browser", source: "vercel-labs/agent-browser", versionHash: "80161e6812345678", canCheckForUpdates: true } };

test("plugin management shows the package identity, localized status and supported actions without a duplicate reload", () => {
  const html = render(MarketPluginManagement, { pkg: plugin, cwd: "E:/project", busy: false, action: null, onAction() {} });
  assert.match(html, /<h2[^>]*>billion-context<\/h2>/);
  assert.match(html, /data-installation-state="installed"/);
  assert.match(html, /V0\.1\.208/);
  assert.match(html, />Update<\/button>/);
  assert.match(html, />Uninstall<\/button>/);
  assert.match(html, /No resolved resources yet/);
  assert.doesNotMatch(html, /Reload session|Quick start|Version history/);
  assert.match(html, /<details data-market-install-details/);
});

test("plugin resources group real entries and disabled packages retain their management state", () => {
  const pkg = { ...plugin, disabled: true, status: "disabled", resources: [{ kind: "skill", name: "data-tool", path: "E:/pkg/SKILL.md", relativePath: "skills/data-tool/SKILL.md" }] };
  const html = render(MarketPluginManagement, { pkg, cwd: "E:/project", busy: true, action: "disable", onAction() {} });
  assert.match(html, /data-installation-state="disabled"/);
  assert.match(html, /data-tool/);
  assert.match(html, /skills\/data-tool\/SKILL\.md/);
  assert.doesNotMatch(html, /No resolved resources yet/);
  assert.match(html, /disabled=""/);
});

test("skill management shows a hash and exposes update only after a new version is detected", () => {
  const props = { skill, cwd: "E:/project", busy: false, checking: false, updating: false, onToggle() {}, onCheck() {}, onUpdate() {} };
  const html = render(MarketSkillManagement, props);
  assert.match(html, /Version hash/);
  assert.match(html, /80161e68/);
  assert.doesNotMatch(html, /V80161e68|Uninstall|>Update<\/button>/);
  assert.match(html, /Check updates/);
  const updated = render(MarketSkillManagement, { ...props, update: { state: "update-available", currentVersion: "80161e6812345678", latestVersion: "bb221100abcdef00" } });
  assert.match(updated, />Update<\/button>/);
  assert.match(updated, /bb221100/);
  assert.doesNotMatch(updated, /Vbb221100/);
});

test("manual skills keep external-directory scope and cannot fabricate update or uninstall support", () => {
  const html = render(MarketSkillManagement, { skill: { ...skill, install: undefined, sourceInfo: {}, description: "<script>unsafe()</script>" }, cwd: "E:/project", busy: false, checking: false, updating: false, onToggle() {}, onCheck() {}, onUpdate() {} });
  assert.match(html, /External directory/);
  assert.doesNotMatch(html, /Check updates|>Update<\/button>|Uninstall|<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("registered skills expose scoped uninstall and show a disabled pending action", () => {
  const props = { skill, cwd: "E:/project", busy: false, checking: false, updating: false, onToggle() {}, onCheck() {}, onUpdate() {}, onUninstall() {} };
  assert.match(render(MarketSkillManagement, props), />Uninstall<\/button>/);
  const pending = render(MarketSkillManagement, { ...props, busy: true, uninstalling: true });
  assert.match(pending, /Uninstalling/); assert.match(pending, /disabled=""/);
  assert.doesNotMatch(render(MarketSkillManagement, { ...props, skill: { ...skill, managedPlugin: { capabilityId: "owned" } } }), />Uninstall<\/button>/);
});

test("shared runtime retains release version formatting and supports external skill paths", () => {
  const release = render(CapabilityInstallRuntime, { scope: "global", version: "v2.4.1", latestVersion: "2.5.0" });
  assert.match(release, /V2\.4\.1/);
  assert.match(release, /V2\.5\.0/);
  const hash = render(CapabilityInstallRuntime, { scope: "path", version: "80161e681234", versionFormat: "hash" });
  assert.match(hash, /External directory/);
  assert.doesNotMatch(hash, /V80161/);
});
