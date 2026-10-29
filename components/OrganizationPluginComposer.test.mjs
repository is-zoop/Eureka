import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css")) return { format: "module", source: "export default new Proxy({}, { get: (_, name) => String(name) });", shortCircuit: true };
    return nextLoad(url, context);
  },
});
after(() => cssHook.deregister());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ChatInput, buildSlashCommandLayout, SlashCommandPaletteIcon } = await jiti.import("./ChatInput.tsx");
const { BrowserPanel } = await jiti.import("./BrowserPanel.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { setDraft, clearDraft } = await jiti.import("@/lib/draft-store");
const { selectionEnvelope } = await jiti.import("@/lib/plugin-selection");
const { MessageView } = await jiti.import("./MessageView.tsx");
const { OrganizationPluginDialog } = await jiti.import("./OrganizationPluginDialog.tsx");
const { HazeCapabilityInstallDialog, HazeMcpConfigDialog } = await jiti.import("./HazeCapabilityDialog.tsx");
const { annotateSkillCommandCapabilities } = await jiti.import("@/lib/organization-capability");
const plugin = { source: "https://haze.example", capabilityId: "42", digest: "a".repeat(64), name: "Atlas数据助手", description: "Atlas", skills: ["atlas-menu", "atlas-ask"], state: "loaded" };
function render(element) { return renderToStaticMarkup(React.createElement(I18nProvider, null, element)); }
test("organization plugins form their own command group without replacing skills or extensions", () => {
  const result = buildSlashCommandLayout([{ source: "plugin", name: plugin.name, plugin }, { source: "skill", name: "skill:atlas-menu" }, { source: "extension", name: "mcp" }], {});
  assert.deepEqual(result.groups.map((group) => group.source), ["plugin", "extension", "skill"]);
  assert.equal(result.commands.length, 3);
});

test("existing-session skill command rows inherit the plugin icon from matching resource paths", () => {
  const filePath = "C:\\agent\\plugins\\42\\skills\\atlas-menu\\SKILL.md";
  const capability = { capabilityId: "42", source: plugin.source };
  const commands = [
    { source: "skill", name: "skill:atlas-menu", sourceInfo: { path: filePath.toLowerCase().replaceAll("\\", "/") } },
    { source: "skill", name: "skill:atlas-menu", sourceInfo: { path: "C:/local/atlas-menu/SKILL.md" } },
    { source: "extension", name: "atlas-menu", sourceInfo: { path: filePath } },
    { source: "skill", name: "skill:other", sourceInfo: { path: filePath } },
    { source: "skill", name: "skill:atlas-menu" },
  ];
  const result = annotateSkillCommandCapabilities(commands, [{ name: "atlas-menu", filePath, organizationCapability: capability }]);
  assert.deepEqual(result[0].organizationCapability, capability);
  const html = render(React.createElement(SlashCommandPaletteIcon, { command: result[0], source: "skill" }));
  assert.match(html, /<img[^>]+src="\/api\/organization-extensions\/42\/icon\?source=https%3A%2F%2Fhaze.example"/);
  for (const command of result.slice(1)) {
    assert.equal(command.organizationCapability, undefined);
    assert.doesNotMatch(render(React.createElement(SlashCommandPaletteIcon, { command, source: command.source })), /<img/);
  }
  const missing = annotateSkillCommandCapabilities(commands, []);
  assert.equal(missing[0].organizationCapability, undefined);
  assert.equal(commands[0].organizationCapability, undefined, "display enrichment must not mutate the session snapshot");
});
test("draft selections render removable plugin labels without a manual browser entry", () => {
  setDraft("plugin-ui", { value: "查询", images: [], selectedPlugins: [plugin] });
  const html = render(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey: "plugin-ui" }));
  assert.match(html, /Atlas数据助手/); assert.match(html, /移除 Atlas数据助手/); assert.doesNotMatch(html, /composer-browser-entry|◉ 浏览器/);
  assert.match(html, /<img[^>]+src="\/api\/organization-extensions\/42\/icon\?source=https%3A%2F%2Fhaze.example"/);
  clearDraft("plugin-ui");
});

test("selected skill commands render a removable icon chip and keep arguments in the textarea", () => {
  setDraft("skill-chip", { value: "/skill:atlas-ask 查询昨日天猫流量", images: [] });
  const html = render(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: false, draftKey: "skill-chip",
    slashCommands: [{ source: "skill", name: "skill:atlas-ask", organizationCapability: { capabilityId: "42", source: plugin.source } }],
  }));
  assert.match(html, /class="composer-command-chip"/);
  assert.match(html, /class="composer-command-chip" title="atlas-ask" style="[^"]*display:inline-flex;align-items:center;gap:6px/);
  assert.match(html, /class="composer-command-chip"[^>]+style="[^"]*border:1px solid [^"]*border-radius:7px;[^"]*background:/);
  assert.match(html, /class="composer-command-editor" style="position:relative;min-width:0"/);
  assert.match(html, /class="composer-command-chip"[^>]+style="[^"]*position:absolute;top:0;left:0/);
  assert.match(html, /<textarea[^>]+style="[^"]*text-indent:var\(--composer-command-indent, 0px\)/);
  assert.match(html, /<textarea[^>]+style="[^"]*transition-property:color, opacity/);
  assert.doesNotMatch(html, /composer-command-row/);
  assert.match(html, /aria-label="(?:Remove command|移除命令) atlas-ask"/);
  assert.match(html, /src="\/api\/organization-extensions\/42\/icon/);
  assert.match(html, /<textarea[^>]*>查询昨日天猫流量<\/textarea>/);
  assert.doesNotMatch(html, /<textarea[^>]*>\/skill:/);
  clearDraft("skill-chip");
});
test("history shows original user text and plugin label without exposing expanded host context", () => {
  const html = render(React.createElement(MessageView, { message: { role: "user", content: selectionEnvelope("查询昨天销售额", [plugin], "internal plugin context with file paths"), timestamp: Date.now() } }));
  assert.match(html, /Atlas数据助手/); assert.match(html, /查询昨天销售额/);
  assert.match(html, /<img[^>]+src="\/api\/organization-extensions\/42\/icon\?source=https%3A%2F%2Fhaze.example"/);
  assert.doesNotMatch(html, /internal plugin context|eureka-selected-plugins/);
});



test("plugin confirmation shows the same icon as its organization extension", () => {
  const html = render(React.createElement(OrganizationPluginDialog, {
    item: { ...plugin, id: "42", type: "Plugin", iconUrl: "/api/organization-extensions/42/icon" },
    cwd: "/project", busy: false, onClose() {}, onConfirm: async () => true,
  }));
  assert.match(html, /<header[^>]*>[\s\S]*?<img[^>]+src="\/api\/organization-extensions\/42\/icon"/);
  assert.match(html, /Atlas数据助手/);
});

test("enterprise Skill and MCP dialogs use their catalog icon", () => {
  for (const type of ["Skill", "MCP"]) {
    const item = { ...plugin, id: "88", type, iconUrl: "/api/organization-extensions/88/icon" };
    const html = render(React.createElement(HazeCapabilityInstallDialog, { item, cwd: "/project", busy: false, onClose() {}, onConfirm: async () => true }));
    assert.match(html, /<header[^>]*>[\s\S]*?<img[^>]+src="\/api\/organization-extensions\/88\/icon"/);
  }
  const html = render(React.createElement(HazeMcpConfigDialog, { item: { ...plugin, id: "89", type: "MCP", iconUrl: "/api/organization-extensions/89/icon" }, initial: { lifecycle: "lazy", idleTimeout: 10 }, busy: false, onClose() {}, onConfirm: async () => true }));
  assert.match(html, /<header[^>]*>[\s\S]*?<img[^>]+src="\/api\/organization-extensions\/89\/icon"/);
});
test("navigation-fixed installation dialogs never ask for the destination scope", () => {
  for (const type of ["Skill", "MCP", "Plugin"]) {
    for (const fixedScope of ["global", "project"]) {
      const html = render(React.createElement(HazeCapabilityInstallDialog, {
        item: { ...plugin, id: "88", type, iconUrl: "/api/organization-extensions/88/icon" },
        cwd: "/project", fixedScope, busy: false, onClose() {}, onConfirm: async () => true,
      }));
      assert.doesNotMatch(html, /name="plugin-scope"|aria-label="(?:Installation scope|安装范围)"/);
      assert.match(html, /(?:Confirm install|确认安装)/);
      if (type === "MCP") assert.match(html, /type="number"/, "connector runtime configuration stays available");
    }
  }
});

test("browser panel offers navigation and empty-state guidance without an external iframe", () => {
  const html = render(React.createElement(BrowserPanel, { sessionId: "chat", onHide() {} }));
  assert.match(html, /网页地址/); assert.match(html, /新建标签页/); assert.match(html, /关闭浏览器并清理/);
  assert.doesNotMatch(html, /<iframe/);
});
