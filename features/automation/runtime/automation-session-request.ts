import { assertSdkContract } from "../sdk/automation-sdk-contract";
import { appJsonValue, type AppJson } from "./automation-app-run";
import type { AppFileRef } from "./automation-app-run";
import contract from "../sdk/automation-sdk-contract.json";

export interface AppSessionRequest {
  url: string;
  method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
  credentials?: "browser" | "omit";
  headers?: Record<string, string>;
  response?: "json" | "text" | "bytes";
  allowDynamicUrl?: boolean;
  signature?: { kind: "taobao-mtop"; appKey: string };
  auth?: { kind: "bearer" | "api-key"; credentialId: string; header?: string };
  multipart?: { fields?: string[]; files: { name: string; multiple?: boolean; contentTypes?: string[]; maxBytes?: number }[]; maxBytes?: number };
  responseHeaders?: string[];
  redirects?: number;
  timeoutMs?: number;
}
export interface AppSessionRequestInput { url?: string; query?: Record<string, string>; form?: Record<string, string>; json?: AppJson; multipart?: { fields?: Record<string,string>; files: { name: string; ref: AppFileRef; filename?: string; contentType?: string }[] } }
export function appAuthHeader(auth: NonNullable<AppSessionRequest["auth"]>) {
  const header = auth.kind === "bearer" ? "Authorization" : auth.header ?? "X-API-Key";
  if (!/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(header) || auth.kind === "bearer" && auth.header !== undefined || auth.kind === "api-key" && /^(?:authorization|cookie|set-cookie|host|origin|referer|content-type|content-length|connection|transfer-encoding|proxy-.+|sec-.+)$/i.test(header)) throw new Error("凭证请求头不受支持。");
  return header;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API 请求必须为对象。");
  return value as Record<string, unknown>;
};
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("API 请求含未支持的属性。");
}
function strings(value: unknown): Record<string, string> {
  const entries = Object.entries(object(value));
  if (entries.length > 100 || entries.some(([key, value]) => !key || key.length > 200 || /[\r\n\x00]/.test(key) || typeof value !== "string" || value.length > 64000)) throw new Error("API 参数格式或大小无效。");
  return Object.fromEntries(entries) as Record<string, string>;
}
export function parseAppSessionRequest(value: unknown): AppSessionRequest {
  assertSdkContract("request", value);
  const v = object(value); only(v, ["url", "method", "credentials", "headers", "response", "signature", "allowDynamicUrl", "auth", "multipart", "responseHeaders", "redirects", "timeoutMs"]);
  if (typeof v.url !== "string" || v.url.length > 4096) throw new Error("API URL 无效。");
  let url: URL;
  try { url = new URL(v.url); } catch { throw new Error("API URL 无效，需要完整的 HTTP 或 HTTPS 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("API 地址仅支持 HTTP 或 HTTPS 协议。");
  if (url.username || url.password) throw new Error("API 地址不能包含用户名或密码，请使用私有配置传入业务参数。");
  if (url.hash || url.href.endsWith("#")) throw new Error("API 地址不能包含 #fragment，片段不会发送给服务端。");
  if (typeof v.method !== "string" || !["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(v.method)) throw new Error("API 方法不支持。");
  if (v.credentials !== undefined && v.credentials !== "browser" && v.credentials !== "omit") throw new Error("API credentials 需要 browser 或 omit。");
  if (v.response !== undefined && (typeof v.response!=="string"||!["json", "text", "bytes"].includes(v.response))) throw new Error("API 响应类型不支持。");
  if(v.allowDynamicUrl!==undefined&&(typeof v.allowDynamicUrl!=="boolean"||v.allowDynamicUrl&&(v.method!=="GET"||v.response!=="bytes"||url.search||v.signature)))throw new Error("动态下载地址仅支持无签名、无固定 query 的 GET bytes 声明。");
  const result: AppSessionRequest = { url: url.href, method: v.method as AppSessionRequest["method"], response: v.response as AppSessionRequest["response"] ?? "json" };
  if (v.credentials !== undefined) result.credentials = v.credentials;
  if (v.auth !== undefined) {
    result.auth = v.auth as AppSessionRequest["auth"]; appAuthHeader(result.auth!);
    if (url.protocol !== "https:" || v.credentials !== "omit" || v.signature) throw new Error("独立凭证仅用于 HTTPS、credentials:omit 请求，不能与 MTOP 签名混用。");
  }
  if (v.multipart !== undefined) {
    if (!["POST", "PUT", "PATCH"].includes(String(v.method)) || v.signature) throw new Error("文件上传仅支持无 MTOP 签名的 POST/PUT/PATCH。");
    result.multipart = v.multipart as AppSessionRequest["multipart"];
    if (new Set(result.multipart!.files.map(file => file.name)).size !== result.multipart!.files.length) throw new Error("上传字段名称重复。");
    if (Object.keys((v.headers ?? {}) as object).some(key => key.toLowerCase() === "content-type")) throw new Error("multipart Content-Type 由宿主生成。");
  }
  if (v.timeoutMs !== undefined) result.timeoutMs = Number(v.timeoutMs);
  if (v.responseHeaders !== undefined) result.responseHeaders = v.responseHeaders as string[];
  if (v.redirects !== undefined) {
    if (Number(v.redirects) > 0 && (!["GET", "HEAD"].includes(String(v.method)) || v.signature || v.multipart || v.allowDynamicUrl)) throw new Error("重定向仅支持普通 GET/HEAD 只读声明。");
    result.redirects = Number(v.redirects);
  }
  if(v.allowDynamicUrl!==undefined)result.allowDynamicUrl=v.allowDynamicUrl as boolean;
  if (v.headers !== undefined) {
    const headers = strings(v.headers);
    if (Object.entries(headers).some(([key, value]) => !/^(?:accept|content-type|referer|x-requested-with|user-agent)$/i.test(key) || /[\r\n\x00]/.test(value))) throw new Error("API 请求头仅支持 Accept、Content-Type、Referer、X-Requested-With、User-Agent；Cookie 由宿主注入。");
    result.headers = headers;
  }
  if (v.signature !== undefined) {
    const s = object(v.signature); only(s, ["kind", "appKey"]);
    if (s.kind !== "taobao-mtop" || typeof s.appKey !== "string" || !/^\d{1,30}$/.test(s.appKey) || url.protocol !== "https:" || v.credentials === "omit" || !["taobao.com", "tmall.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new Error("MTOP 签名需要淘宝/天猫 HTTPS 地址和浏览器登录态。");
    if (["sign", "t", "appKey"].some(key => url.searchParams.has(key)) || url.searchParams.getAll("data").length > 1) throw new Error("MTOP URL 不能预置 sign、t、appKey 或重复的 data；签名参数由宿主生成。");
    result.signature = { kind: "taobao-mtop", appKey: s.appKey };
  }
  return result;
}
export function parseAppSessionRequestInput(value: unknown, request: AppSessionRequest): AppSessionRequestInput {
  const v = object(value ?? {}); only(v, ["url", "query", "form", "json", "multipart"]);
  if (v.multipart !== undefined) {
    if (!request.multipart || v.form !== undefined || v.json !== undefined) throw new Error("上传必须显式声明，且不能混用 form/json。");
    const upload = object(v.multipart); only(upload, ["fields", "files"]);
    const fields = upload.fields === undefined ? {} : strings(upload.fields);
    if (Object.keys(fields).some(key => !request.multipart!.fields?.includes(key)) || !Array.isArray(upload.files) || !upload.files.length || upload.files.length > contract.limits.uploadFiles) throw new Error("上传字段或文件数量超出声明。");
    const counts = new Map<string,number>();
    for (const raw of upload.files) {
      const file = object(raw); only(file, ["name", "ref", "filename", "contentType"]);
      const declared = request.multipart.files.find(item => item.name === file.name); const ref = object(file.ref); only(ref, ["grantId", "relative", "label", "access"]);
      if (!declared || typeof ref.grantId !== "string" || !ref.grantId || ref.relative !== undefined && typeof ref.relative !== "string" || file.filename !== undefined && (typeof file.filename !== "string" || !file.filename || file.filename.length > 200 || /[\\/\r\n\x00"]/.test(file.filename))) throw new Error("上传文件引用或名称无效。");
      const type = file.contentType ?? "application/octet-stream";
      if (typeof type !== "string" || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(type) || declared.contentTypes && !declared.contentTypes.includes(type)) throw new Error("上传内容类型不在声明范围。");
      const count = (counts.get(String(file.name)) ?? 0) + 1; counts.set(String(file.name), count); if (count > 1 && !declared.multiple) throw new Error("该上传字段不允许多个文件。");
    }
  }
  if (v.form !== undefined && v.json !== undefined || ["GET", "HEAD"].includes(request.method) && (v.form !== undefined || v.json !== undefined)) throw new Error("API 请求体格式冲突：form 与 json 二选一，GET/HEAD 不携带请求体。");
  const result: AppSessionRequestInput = {};
  if(v.url!==undefined){
    if(!request.allowDynamicUrl||typeof v.url!=="string"||v.url.length>16000)throw new Error("未声明动态下载地址，或地址无效。");
    const base=new URL(request.url);let target:URL;try{target=new URL(v.url);}catch{throw new Error("下载地址无效。");}
    if(target.origin!==base.origin||target.username||target.password||target.hash||/%(?:2f|5c)/i.test(target.pathname)||!(target.pathname===base.pathname||base.pathname.endsWith("/")&&target.pathname.startsWith(base.pathname)))throw new Error("下载地址超出声明的域名或路径范围。");
    result.url=target.href;
  }
  if (v.query !== undefined) result.query = strings(v.query);
  if (v.form !== undefined) result.form = strings(v.form);
  if (v.json !== undefined) result.json = appJsonValue(v.json, 64000);
  if (v.multipart !== undefined) result.multipart = v.multipart as AppSessionRequestInput["multipart"];
  if (Buffer.byteLength(JSON.stringify(result)) > 64000) throw new Error("API 请求参数过大。");
  if (request.signature) {
    const query = new URL(request.url).searchParams;
    for (const [key, value] of Object.entries(result.query ?? {})) query.set(key, value);
    if (typeof (result.form?.data ?? query.get("data")) !== "string" || ["sign", "t", "appKey"].some(key => query.has(key) || Object.hasOwn(result.form ?? {}, key))) throw new Error("MTOP 请求需要原始 data 文本；sign、t、appKey 由宿主计算。");
    if (query.getAll("data").length > 1 || result.form?.data !== undefined && query.has("data")) throw new Error("MTOP data 只能声明一次，避免签名与请求不一致。");
  }
  return result;
}
