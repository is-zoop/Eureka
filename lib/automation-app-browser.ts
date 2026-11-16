import { appJsonValue, type AppJson } from "./automation-app-run";
import { appAuthHeader, parseAppSessionRequest, type AppSessionRequest } from "./automation-session-request";
import contract from "./automation-sdk-contract.json";
import { DEFAULT_BROWSER_ID } from "./automation-accounts";
/** Persistent profile identity is independent of action, site and run IDs. */
export const appBrowserEnvironment = (environments: Record<string, string>, siteId: string) => environments[siteId] ?? DEFAULT_BROWSER_ID;
export interface AppLocator { css?: string; role?: string; name?: string; label?: string; text?: string; testId?: string; nth?: number; within?: AppLocator; context?: { kind: "frame" | "shadow"; locator: AppLocator }[] }
export interface AppPageField { locator?: AppLocator; source?: "text" | "value" | "checked" | "attribute"; attribute?: string; type?: "text" | "number" | "percentage" | "boolean" | "date" | "object" | "list"; prefix?: string; suffix?: string; optional?: boolean }
export interface AppWebOperation {
  id: string; label: string; description: string; effect: "query" | "mutation";
  kind: "click" | "fill" | "select" | "check" | "enter" | "request" | "upload";
  upload?: { multiple?: boolean; contentTypes?: string[]; maxBytes?: number };
  locator?: AppLocator; row?: { locator: AppLocator; key: AppPageField };
  request?: AppSessionRequest;
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
  const v = object(raw); keys(v, ["css", "role", "name", "label", "text", "testId", "nth", "within", "context"]);
  if (["css", "role", "label", "text", "testId"].filter(k => v[k] !== undefined).length !== 1 || (v.name !== undefined && v.role === undefined)) bad("定位方式需要唯一");
  const result: AppLocator = {};
  for (const key of ["css", "role", "name", "label", "text", "testId"] as const) if (v[key] !== undefined) result[key] = string(v[key]);
  if (v.nth !== undefined) { if (!Number.isInteger(v.nth) || Number(v.nth) < 0 || Number(v.nth) > 9999) bad("定位序号无效"); result.nth = Number(v.nth); }
  if (v.within !== undefined) result.within = parseAppLocator(v.within, depth + 1);
  if (v.context !== undefined) {
    if (!Array.isArray(v.context) || !v.context.length || v.context.length > 3 || depth + v.context.length > 3) bad("页面上下文最多嵌套三层");
    result.context = v.context.map((raw, index) => { const step = object(raw); keys(step, ["kind", "locator"]); if (step.kind !== "frame" && step.kind !== "shadow") bad("页面上下文类型无效"); return { kind: step.kind, locator: parseAppLocator(step.locator, depth + index + 1) }; });
  }
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
      const o = object(raw); keys(o, ["id", "label", "description", "effect", "kind", "locator", "row", "verify", "request", "upload"]);
      if (typeof o.effect !== "string" || !["query", "mutation"].includes(o.effect) || typeof o.kind !== "string" || !["click", "fill", "select", "check", "enter", "request", "upload"].includes(o.kind)) bad("操作类型无效");
      const op: AppWebOperation = { id: id(o.id), label: string(o.label, 120), description: string(o.description, 2000), effect: o.effect as AppWebOperation["effect"], kind: o.kind as AppWebOperation["kind"] };
      if (op.kind === "request") {
        if (o.locator !== undefined || o.row !== undefined) bad("API 请求不使用控件定位或行定位");
        op.request = parseAppSessionRequest(o.request);
        if (op.request.multipart && (o.effect !== "mutation" || !capabilities.includes("files.read"))) bad("上传需要 mutation、browser.write 和 files.read 能力");
        if (op.request.redirects && o.effect !== "query") bad("仅只读请求可声明重定向");
      } else {
        if (o.request !== undefined) bad("只有 request 操作可声明 API");
        op.locator = parseAppLocator(o.locator);
      }
      if (op.kind === "upload") {
        if (op.effect !== "mutation" || !capabilities.includes("files.read")) bad("浏览器上传需要 mutation、browser.write 和 files.read");
        const upload = object(o.upload); keys(upload, ["multiple", "contentTypes", "maxBytes"]);
        if (upload.multiple !== undefined && typeof upload.multiple !== "boolean" || upload.maxBytes !== undefined && (!Number.isSafeInteger(upload.maxBytes) || Number(upload.maxBytes) < 1 || Number(upload.maxBytes) > contract.limits.uploadBytes) || upload.contentTypes !== undefined && (!Array.isArray(upload.contentTypes) || !upload.contentTypes.length || upload.contentTypes.length > 32 || upload.contentTypes.some(type => typeof type !== "string" || !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(type)))) bad("浏览器上传类型或大小限制无效");
        op.upload = upload as AppWebOperation["upload"];
      } else if (o.upload !== undefined) bad("upload 配置仅用于上传控件");
      if (o.row !== undefined) { const r = object(o.row); keys(r, ["locator", "key"]); op.row = { locator: parseAppLocator(r.locator), key: parseAppPageField(r.key) }; }
      if (o.verify !== undefined) {
        const q = object(o.verify); keys(q, ["field", "mode", "expected", "input"]);
        if (typeof q.mode !== "string" || !["equals", "changed"].includes(q.mode) || (q.input !== undefined && typeof q.input !== "boolean")) bad("校验规则无效");
        if (q.mode === "equals" && q.input !== true && q.expected === undefined) bad("校验缺少预期值");
        if (q.mode === "changed" && (q.expected !== undefined || q.input !== undefined) || q.input === true && q.expected !== undefined) bad("校验预期方式应唯一");
        op.verify = { field: parseAppPageField(q.field), mode: q.mode as "equals" | "changed", ...(q.expected !== undefined ? { expected: appJsonValue(q.expected, 65536) } : {}), ...(q.input !== undefined ? { input: q.input as boolean } : {}) };
      }
      if (op.effect === "mutation" && !capabilities.includes("browser.write")) bad("网页或 API 变更需要 browser.write");
      if (op.effect === "mutation" && op.kind !== "request" && (!s.account || !op.verify)) bad("网页控件变更需要账号标记和校验规则");
      if (op.kind === "request" && op.verify?.input) bad("API 校验需要明确 expected 或 changed 字段规则");
      return op;
    });
    if (new Set(operations.map(o => o.id)).size !== operations.length) bad("操作 ID 重复");
    const site: AppBrowserSite = { id: id(s.id), label: string(s.label, 120), startUrl, paths, operations, ...(s.account !== undefined ? { account: parseAppPageField(s.account) } : {}) };
    if (!appSiteAllows(site, startUrl) || (site.account && (!site.account.locator || site.account.type !== "text"))) bad("入口不在路径范围或账号文本定位缺失");
    return site;
  });
  if (new Set(sites.map(s => s.id)).size !== sites.length) bad("网站 ID 重复");
  const credentials = new Map<string, { signature: string; scopes: Set<string> }>();
  for (const site of sites) for (const operation of site.operations) if (operation.request?.auth) {
    const { auth } = operation.request, signature = `${auth.kind}:${appAuthHeader(auth).toLowerCase()}`, url = new URL(operation.request.url), scope = `${operation.request.method} ${url.origin}${url.pathname}`;
    const previous = credentials.get(auth.credentialId);
    if (previous && previous.signature !== signature) bad("同名接口凭证不能声明不同类型或请求头");
    const specification = previous ?? { signature, scopes: new Set<string>() }; specification.scopes.add(scope);
    if (specification.scopes.size > 100) bad("单个凭证最多声明100个接口目标"); credentials.set(auth.credentialId, specification);
  }
  return { schemaVersion: 1, sites };
}
