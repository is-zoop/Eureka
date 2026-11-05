import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { pluginRelativePath, readPluginZip } from "./haze-plugin-package";
import { APP_CAPABILITIES, isAppId, isAppVersion, type AppCapability, type AutomationAppAction, type AutomationAppManifest, type AutomationAppUi, type AutomationAppWorkflow } from "./automation-app";
import { appParameters } from "./automation-app-run";
import { parseAppBrowser } from "./automation-app-browser";
import { parseAppAiRules } from "./automation-app-ai";

export const MAX_APP_ZIP = 20 * 1024 * 1024;
// Leaves room for ZIP headers so every exported (stored) archive can be re-imported.
export const MAX_APP_EXPANDED = 16 * 1024 * 1024;
export class AutomationAppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export interface AutomationAppPackage {
  manifest: AutomationAppManifest; ui: AutomationAppUi; workflow: AutomationAppWorkflow;
  files: Map<string, Buffer>; digest: string; readme: string;
  actions?: AutomationAppAction[];
}
function invalid(message: string): never { throw new AutomationAppError(`应用包无效：${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("声明必须为 JSON 对象");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, limit = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) invalid(`${name} 缺失或过长`);
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("包含未支持的声明字段");
}
function array(value: unknown, name: string, max = 256): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${name} 必须为不超过 ${max} 项的数组`);
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value)) invalid("字段或节点 ID 无效");
  return value;
}
function unique(values: string[], name: string) { if (new Set(values.map(v => v.toLowerCase())).size !== values.length) invalid(`${name} 重复`); }
function optionalText(value: unknown, name: string) { return value === undefined ? undefined : text(value, name, 4000); }
function optionalBoolean(value: unknown): boolean | undefined { if (value !== undefined && typeof value !== "boolean") invalid("布尔声明无效"); return value as boolean | undefined; }
export function automationPublishPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 240) invalid("发布路径无效");
  const path = pluginRelativePath(value);
  // Only code, UI, workflow, rules, resources and documentation are publishable.
  // There is deliberately no config/data/logs/evidence/output directory here.
  if (!["plugin.json", "package.json", "ui.json", "workflow.json", "README.md"].includes(path) &&
    !/^(?:scripts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:mjs|js|json)|(?:ui|workflows)\/[a-zA-Z0-9_-]+\.json|ai\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:md|json)|assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:svg|png|jpg|jpeg|webp|css|json|txt))$/.test(path)) invalid(`不允许发布文件：${path}`);
  return path;
}
const publishPath = automationPublishPath;
const VALUE_TYPES = ["text", "number", "boolean", "date", "percentage", "object", "list"];
function parseUi(raw: unknown): AutomationAppUi {
  const ui = object(raw); keys(ui, ["schemaVersion", "fields", "buttons", "results"]);
  if (ui.schemaVersion !== 1) invalid("ui.schemaVersion 必须为 1");
  const fields = array(ui.fields, "配置项").map(raw => {
    const v = object(raw); keys(v, ["id", "label", "type", "required", "description", "default", "multiline"]);
    if (typeof v.type !== "string" || ![...VALUE_TYPES, "file", "directory"].includes(v.type)) invalid("配置项类型不支持");
    if (["file", "directory"].includes(v.type) && v.default !== undefined) invalid("文件配置项不能携带默认路径或用户授权");
    if(v.multiline!==undefined&&(typeof v.multiline!=="boolean"||v.type!=="text"))invalid("多行输入只适用于文本字段");
    return { id: identifier(v.id), label: text(v.label, "配置项名称"), type: v.type as AutomationAppUi["fields"][number]["type"], ...(v.required !== undefined ? { required: optionalBoolean(v.required) } : {}), ...(v.description !== undefined ? { description: optionalText(v.description, "配置项说明") } : {}), ...(v.default !== undefined ? { default: v.default } : {}),...(v.multiline!==undefined?{multiline:v.multiline as boolean}:{}) };
  });
  const buttons = array(ui.buttons, "按钮", 32).map(raw => { const v = object(raw); keys(v, ["id", "label", "action"]); if (v.action !== "run") invalid("按钮动作不支持"); return { id: identifier(v.id), label: text(v.label, "按钮名称"), action: "run" as const }; });
  const results = object(ui.results); keys(results, ["columns", "download"]);
  const columns = array(results.columns, "输出列").map(raw => { const v = object(raw); keys(v, ["key", "label", "type"]); if (typeof v.type !== "string" || !VALUE_TYPES.includes(v.type)) invalid("输出列类型不支持"); return { key: identifier(v.key), label: text(v.label, "列名"), type: v.type as AutomationAppUi["results"]["columns"][number]["type"] }; });
  unique(fields.map(v => v.id), "配置项 ID"); unique(buttons.map(v => v.id), "按钮 ID"); unique(columns.map(v => v.key), "输出列 ID");
  const parsed: AutomationAppUi = { schemaVersion: 1, fields, buttons, results: { columns, ...(results.download !== undefined ? { download: optionalBoolean(results.download) } : {}) } };
  try { appParameters(parsed, Object.fromEntries(fields.filter(f => f.default !== undefined).map(f => [f.id, f.default])), false); } catch { invalid("配置项默认值的类型不正确"); }
  return parsed;
}
function parseWorkflow(raw: unknown, files: Map<string, Buffer>): AutomationAppWorkflow {
  const wf = object(raw); keys(wf, ["schemaVersion", "nodes", "edges"]);
  if (wf.schemaVersion !== 1) invalid("workflow.schemaVersion 必须为 1");
  const nodes = array(wf.nodes, "节点").map(raw => {
    const v = object(raw); keys(v, ["id", "label", "kind", "script", "description"]);
    if (typeof v.kind !== "string" || !["script", "browser", "ai", "branch", "loop", "wait-user"].includes(v.kind)) invalid("节点类型不支持");
    if (v.script !== undefined && (typeof v.script !== "string" || !/^scripts\/.+\.(?:mjs|js)$/.test(v.script) || !files.has(v.script))) invalid("节点脚本不在发布清单中");
    return { id: identifier(v.id), label: text(v.label, "节点名称"), kind: v.kind as AutomationAppWorkflow["nodes"][number]["kind"], ...(typeof v.script === "string" ? { script: v.script } : {}), ...(v.description !== undefined ? { description: optionalText(v.description, "节点说明") } : {}) };
  });
  if (!nodes.length) invalid("流程至少需要一个节点");
  unique(nodes.map(v => v.id), "节点 ID"); const ids = new Set(nodes.map(v => v.id));
  const edges = array(wf.edges, "连接", 1024).map(raw => { const v = object(raw); keys(v, ["from", "to", "label", "when"]); const from = identifier(v.from), to = identifier(v.to); if (!ids.has(from) || !ids.has(to)) invalid("连接引用不存在的节点"); return { from, to, ...(v.label !== undefined ? { label: text(v.label, "连接名称") } : {}), ...(v.when !== undefined ? { when: text(v.when, "分支条件", 4000) } : {}) }; });
  return { schemaVersion: 1, nodes, edges };
}
export function appPackageDigest(files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) hash.update(`${Buffer.byteLength(path)}:${path}:${data.length}:`).update(data);
  return hash.digest("hex");
}
/** Never imports an entry, resolves dependencies, runs scripts or reads user data. */
export function inspectAutomationFiles(files: Map<string, Buffer>): AutomationAppPackage {
  if (!files.size || files.size > 256 || [...files.values()].reduce((n, b) => n + b.length, 0) > MAX_APP_EXPANDED) invalid("文件数量或总大小超限");
  unique([...files.keys()], "文件路径");
  for (const name of files.keys()) if (publishPath(name) !== name) invalid("请使用规范相对路径");
  const json = (name: string) => { const file = files.get(name); if (!file || file.length > 1024 * 1024) invalid(`缺少或过大的 ${name}`); try { return object(JSON.parse(file.toString("utf8"))); } catch { invalid(`${name} 不是有效 JSON`); } };
  const raw = json("plugin.json"), pkg = json("package.json");
  if (raw.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" || typeof raw.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.name) || !isAppVersion(raw.version)) invalid("插件身份或版本不支持");
  keys(raw, ["$schema", "name", "version", "description", "extensions"]);
  const ext = object(raw.extensions); keys(ext, ["com.eureka"]); const host = object(ext["com.eureka"]); keys(host, ["schemaVersion", "displayName", "automation"]);
  if (host.schemaVersion !== 1) invalid("Eureka schemaVersion 必须为 1");
  const app = object(host.automation); keys(app, ["schemaVersion", "id", "runtime", "entry", "ui", "workflow", "capabilities", "files", "browser", "actions"]);
  if (app.schemaVersion !== 1 || !isAppId(app.id) || app.runtime !== "javascript-esm" || app.ui !== "ui.json" || app.workflow !== "workflow.json") invalid("自动化应用声明无效");
  const published = array(app.files, "发布清单").map(publishPath); unique(published, "发布清单");
  if (published.length !== files.size || published.some(name => !files.has(name))) invalid("发布清单与包内文件不一致；请移除配置、日志、结果和其他未发布文件");
  for (const name of ["plugin.json", "package.json", "ui.json", "workflow.json", "README.md"]) if (!published.includes(name)) invalid(`发布清单缺少 ${name}`);
  if (typeof app.entry !== "string" || !/^scripts\/.+\.(?:mjs|js)$/.test(app.entry) || !files.has(app.entry)) invalid("入口必须为已发布的 JavaScript 脚本");
  const capabilities = array(app.capabilities, "能力", APP_CAPABILITIES.length).map(v => { if (!APP_CAPABILITIES.includes(v as AppCapability)) invalid("不支持的能力声明"); return v as AppCapability; }); unique(capabilities, "能力");
  keys(pkg, ["name", "version", "type", "description", "license", "private", "pi"]);
  if (pkg.name !== raw.name || pkg.version !== raw.version || pkg.type !== "module") invalid("package.json 的名称、版本或 ESM 配置不一致；不允许安装脚本和外部依赖");
  if (pkg.pi !== undefined) { const pi = object(pkg.pi); keys(pi, ["skills"]); if (!Array.isArray(pi.skills) || pi.skills.length) invalid("本地应用包不能混装 Skill；现有企业插件请使用原扩展入口"); }
  const manifest: AutomationAppManifest = { name: raw.name, version: raw.version, displayName: text(host.displayName, "应用名称", 100), description: raw.description === undefined ? "" : text(raw.description, "应用说明", 4000), automation: { schemaVersion: 1, id: app.id, runtime: "javascript-esm", entry: app.entry, ui: "ui.json", workflow: "workflow.json", capabilities, files: published } };
  if (app.browser !== undefined) { try { manifest.automation.browser = parseAppBrowser(app.browser, capabilities); } catch (e) { invalid(e instanceof Error ? e.message : "网页声明不支持"); } }
  if (capabilities.some(c => c === "browser.read" || c === "browser.write") && !manifest.automation.browser) invalid("网页应用需要声明网站、路径和操作范围");
  if(capabilities.includes("ai")){const rules=files.get("ai/rules.json");if(!rules)invalid("AI 应用需要 ai/rules.json");try{parseAppAiRules(rules);}catch(e){invalid(e instanceof Error?e.message:"AI 规则无效");}}
  const readme = files.get("README.md")!; if (readme.length > 256 * 1024) invalid("README.md 过大");
  const ui = parseUi(json("ui.json")), workflow = parseWorkflow(json("workflow.json"), files);
  let actions: AutomationAppAction[] | undefined;
  if (app.actions !== undefined) {
    const declarations = array(app.actions, "功能", 32); if (!declarations.length) invalid("功能声明不能为空");
    actions = declarations.map(raw => {
      const v = object(raw); keys(v, ["id", "label", "description", "entry", "ui", "workflow", "capabilities"]);
      const id = identifier(v.id), label = text(v.label, "功能名称", 100);
      if (typeof v.entry !== "string" || !/^scripts\/.+\.(?:mjs|js)$/.test(v.entry) || !files.has(v.entry)) invalid("功能入口必须是已发布脚本");
      if (typeof v.ui !== "string" || !/^(?:ui\.json|ui\/[a-zA-Z0-9_-]+\.json)$/.test(v.ui) || typeof v.workflow !== "string" || !/^(?:workflow\.json|workflows\/[a-zA-Z0-9_-]+\.json)$/.test(v.workflow)) invalid("功能界面或流程路径无效");
      const ownCaps = v.capabilities === undefined ? undefined : array(v.capabilities, "功能能力", APP_CAPABILITIES.length).map(c => { if (!capabilities.includes(c as AppCapability)) invalid("功能能力必须属于应用声明的能力"); return c as AppCapability; });
      if (ownCaps) unique(ownCaps, "功能能力");
      const definition = parseUi(json(v.ui)), graph = parseWorkflow(json(v.workflow), files);
      return { id, label, entry: v.entry, ui: v.ui, workflow: v.workflow, ...(v.description === undefined ? {} : { description: text(v.description, "功能说明", 1000) }), capabilities: ownCaps ?? [...capabilities], definition: { ...definition, buttons: [{ id, label, action: "run" as const }] }, graph };
    });
    unique(actions.map(action => action.id), "功能 ID");
    manifest.automation.actions = actions.map(({ definition: _definition, graph: _graph, ...declaration }) => declaration);
    ui.buttons = actions.map(action => ({ id: action.id, label: action.label, action: "run" }));
  }
  return { manifest, ui, workflow, ...(actions ? { actions } : {}), files, digest: appPackageDigest(files), readme: readme.toString("utf8") };
}
export function parseAutomationAppArchive(buffer: Buffer): AutomationAppPackage {
  try {
    if (buffer.length > MAX_APP_ZIP) invalid("ZIP 超过 20 MiB");
    const entries = readPluginZip(buffer, { archive: MAX_APP_ZIP, expanded: MAX_APP_EXPANDED, entries: 512 });
    const roots = [...entries.keys()].filter(name => name === "plugin.json" || /^[^/]+\/plugin\.json$/.test(name));
    if (roots.length !== 1) invalid("必须有唯一的 plugin.json 根清单");
    const prefix = roots[0].slice(0, -"plugin.json".length);
    if ([...entries.keys()].some(name => !name.startsWith(prefix))) invalid("包中包含应用目录以外的文件");
    return inspectAutomationFiles(new Map([...entries].map(([name, bytes]) => [name.slice(prefix.length), bytes])));
  } catch (e) { if (e instanceof AutomationAppError) throw e; throw new AutomationAppError(e instanceof Error ? e.message : "无法读取应用包"); }
}
/** Small standard ZIP writer. Export receives only the verified publish list. */
export function writeAutomationAppZip(files: Map<string, Buffer>): Buffer {
  inspectAutomationFiles(files);
  let offset = 0; const local: Buffer[] = [], central: Buffer[] = [];
  for (const [path, data] of files) {
    const name = Buffer.from(path), crc = crc32(data), header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE((0x81a4 * 65536) >>> 0, 38); index.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(index, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
