import { appJsonValue, type AppJson } from "./automation-app-run";
export interface AppLocator { css?: string; role?: string; name?: string; label?: string; text?: string; testId?: string; nth?: number; within?: AppLocator }
export interface AppPageField { locator?: AppLocator; source?: "text" | "value" | "checked" | "attribute"; attribute?: string; type?: "text" | "number" | "percentage" | "boolean" | "date" | "object" | "list"; prefix?: string; suffix?: string; optional?: boolean }
export interface AppWebOperation {
  id: string; label: string; description: string; effect: "query" | "mutation";
  kind: "click" | "fill" | "select" | "check" | "enter";
  locator: AppLocator; row?: { locator: AppLocator; key: AppPageField };
  verify?: { field: AppPageField; mode: "equals" | "changed"; expected?: AppJson; input?: boolean };
}
export interface AppBrowserSite { id: string; label: string; startUrl: string; paths: string[]; account?: AppPageField; operations: AppWebOperation[] }
export interface AppBrowserDeclaration { schemaVersion: 1; sites: AppBrowserSite[] }
export interface AppBrowserBinding { siteId: string; origin: string; environment: string; account: string | null; accountHash: string }
export interface AppWebGrant { id: string; digest: string; siteId: string; origin: string; operationId: string; scopeHash: string; environment: string; accountHash: string; accountLabel: string; approvedAt: string; revokedAt?: string }
export interface AppBrowserApproval { id: string; siteId: string; siteLabel: string; origin: string; version: string; digest: string; environment: string; account: string; requestedOperation: string; operations: AppWebOperation[]; target?: string; value?: AppJson }
export const appBrowserSessionId = (identityKey: string) => `automation:app:${identityKey}`;
function bad(message: string): never { throw new Error(`网页声明无效：${message}`); }
const object = (v: unknown) => { if (!v || typeof v !== "object" || Array.isArray(v)) bad("必须为对象"); return v as Record<string, unknown>; };
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) bad("含未支持的属性"); }
function string(v: unknown, max = 1000) { if (typeof v !== "string" || !v.trim() || v.length > max) bad("文本缺失或过长"); return v; }
function id(v: unknown) { const s = string(v, 80); if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s)) bad("ID 不支持"); return s; }
export function parseAppLocator(raw: unknown, depth = 0): AppLocator {
  if (depth > 3) bad("定位范围嵌套过深");
  const v = object(raw); keys(v, ["css", "role", "name", "label", "text", "testId", "nth", "within"]);
  if (["css", "role", "label", "text", "testId"].filter(k => v[k] !== undefined).length !== 1 || (v.name !== undefined && v.role === undefined)) bad("定位方式需要唯一");
  const result: AppLocator = {};
  for (const key of ["css", "role", "name", "label", "text", "testId"] as const) if (v[key] !== undefined) result[key] = string(v[key]);
  if (v.nth !== undefined) { if (!Number.isInteger(v.nth) || Number(v.nth) < 0 || Number(v.nth) > 9999) bad("定位序号无效"); result.nth = Number(v.nth); }
  if (v.within !== undefined) result.within = parseAppLocator(v.within, depth + 1);
  return result;
}
export function parseAppPageField(raw: unknown): AppPageField {
  const v = object(raw); keys(v, ["locator", "source", "attribute", "type", "prefix", "suffix", "optional"]);
  if (v.source !== undefined && (typeof v.source !== "string" || !["text", "value", "checked", "attribute"].includes(v.source))) bad("读取方式不支持");
  if (v.type !== undefined && (typeof v.type !== "string" || !["text", "number", "percentage", "boolean", "date", "object", "list"].includes(v.type))) bad("字段类型不支持");
  if (v.source === "attribute" && (typeof v.attribute !== "string" || !/^(?:data-[a-z0-9_-]+|aria-label|title|href)$/.test(v.attribute) || /token|cookie|password|secret|signature|auth/i.test(v.attribute))) bad("属性读取不支持");
  if (v.attribute !== undefined && v.source !== "attribute") bad("属性需使用 attribute 读取方式");
  const result: AppPageField = { source: (v.source ?? "text") as AppPageField["source"], type: (v.type ?? "text") as AppPageField["type"] };
  if (v.locator !== undefined) result.locator = parseAppLocator(v.locator);
  if (v.attribute !== undefined) result.attribute = string(v.attribute, 100);
  for (const k of ["prefix", "suffix"] as const) if (v[k] !== undefined) result[k] = string(v[k], 100);
  if (v.optional !== undefined) { if (typeof v.optional !== "boolean") bad("optional 必须为布尔值"); result.optional = v.optional; }
  return result;
}
export function appSiteAllows(site: AppBrowserSite, raw: string): boolean {
  try { const url = new URL(raw), start = new URL(site.startUrl); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === start.origin && site.paths.some(p => p.endsWith("/*") ? url.pathname === p.slice(0, -2) || url.pathname.startsWith(p.slice(0, -1)) : url.pathname === p); } catch { return false; }
}
export function parseAppBrowser(raw: unknown, capabilities: string[]): AppBrowserDeclaration {
  const v = object(raw); keys(v, ["schemaVersion", "sites"]);
  if (v.schemaVersion !== 1 || !Array.isArray(v.sites) || !v.sites.length || v.sites.length > 16 || !capabilities.includes("browser.read")) bad("需要网站及 browser.read 能力");
  const sites = v.sites.map(raw => {
    const s = object(raw); keys(s, ["id", "label", "startUrl", "paths", "account", "operations"]);
    const startUrl = string(s.startUrl, 4096); let url: URL; try { url = new URL(startUrl); } catch { bad("入口 URL 无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) bad("入口 URL 不支持");
    if (!Array.isArray(s.paths) || !s.paths.length || s.paths.length > 32) bad("需要声明网站路径范围");
    const paths = s.paths.map(p => { const value = string(p, 1000); if (!value.startsWith("/") || value.includes("\\") || value.includes("?") || value.includes("#") || /(?:^|\/)\.\.?\//.test(value) || (value.includes("*") && !/^\/(?:[^*]+\/)?\*$/.test(value))) bad("路径仅支持精确路径或末尾 /*"); return value; });
    if (!Array.isArray(s.operations) || s.operations.length > 100) bad("操作数组无效");
    const operations: AppWebOperation[] = s.operations.map(raw => {
      const o = object(raw); keys(o, ["id", "label", "description", "effect", "kind", "locator", "row", "verify"]);
      if (typeof o.effect !== "string" || !["query", "mutation"].includes(o.effect) || typeof o.kind !== "string" || !["click", "fill", "select", "check", "enter"].includes(o.kind)) bad("操作类型无效");
      const op: AppWebOperation = { id: id(o.id), label: string(o.label, 120), description: string(o.description, 2000), effect: o.effect as AppWebOperation["effect"], kind: o.kind as AppWebOperation["kind"], locator: parseAppLocator(o.locator) };
      if (o.row !== undefined) { const r = object(o.row); keys(r, ["locator", "key"]); op.row = { locator: parseAppLocator(r.locator), key: parseAppPageField(r.key) }; }
      if (o.verify !== undefined) {
        const q = object(o.verify); keys(q, ["field", "mode", "expected", "input"]);
        if (typeof q.mode !== "string" || !["equals", "changed"].includes(q.mode) || (q.input !== undefined && typeof q.input !== "boolean")) bad("校验规则无效");
        if (q.mode === "equals" && q.input !== true && q.expected === undefined) bad("校验缺少预期值");
        if (q.mode === "changed" && (q.expected !== undefined || q.input !== undefined) || q.input === true && q.expected !== undefined) bad("校验预期方式应唯一");
        op.verify = { field: parseAppPageField(q.field), mode: q.mode as "equals" | "changed", ...(q.expected !== undefined ? { expected: appJsonValue(q.expected, 65536) } : {}), ...(q.input !== undefined ? { input: q.input as boolean } : {}) };
      }
      if (op.effect === "mutation" && (!capabilities.includes("browser.write") || !s.account || !op.verify)) bad("网页变更需要 browser.write、账号标记和校验规则");
      return op;
    });
    if (new Set(operations.map(o => o.id)).size !== operations.length) bad("操作 ID 重复");
    const site: AppBrowserSite = { id: id(s.id), label: string(s.label, 120), startUrl, paths, operations, ...(s.account !== undefined ? { account: parseAppPageField(s.account) } : {}) };
    if (!appSiteAllows(site, startUrl) || (site.account && (!site.account.locator || site.account.type !== "text"))) bad("入口不在路径范围或账号文本定位缺失");
    return site;
  });
  if (new Set(sites.map(s => s.id)).size !== sites.length) bad("网站 ID 重复");
  return { schemaVersion: 1, sites };
}
