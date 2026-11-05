import { AutomationAppError } from "./automation-app-package";
import type { PublishContext } from "./automation-publication";
import { FormData as UploadFormData, Request as UploadRequest } from "undici";

/** Next's fetch may retain Node's FormData implementation after undici.install(). */
export async function hazeUploadBody(bytes: Buffer, name: string, mime: string) {
  const form = new UploadFormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  const request = new UploadRequest("http://localhost/", { method: "POST", body: form });
  // Serialize with the matching implementation, then send bytes across fetch boundaries.
  return { body: new Uint8Array(await request.arrayBuffer()), headers: { "Content-Type": request.headers.get("content-type")! } };
}

export class HazePublishError extends AutomationAppError {
  constructor(message: string, status: number, readonly hazeCode?: number) { super(message, status); }
}

/** Show validation locations/reasons, never the submitted input or upstream body. */
export function hazePublishFailure(status: number, payload: unknown, path: string): HazePublishError {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const response = record(payload), data = record(response.data);
  const code = typeof response.code === "number" ? response.code : undefined;
  const labels: Record<number, string> = {
    401: "Haze 凭证已失效，请重新登录", 403: "当前用户没有此项发布权限", 404: "Haze 应用不存在或无权访问",
    409: "Haze 状态或版本发生冲突，请刷新后重试", 413: "上传文件超过 Haze 大小限制", 422: "Haze 发布资料或应用包校验失败",
  };
  const codes: Record<number, string> = { 4222: "Haze 业务分类不存在，请重新选择", 42231: "Haze 应用包兼容性校验失败", 40930: "Haze 资料已被其他操作修改，请刷新后重试", 40932: "恢复请求内容不一致，请刷新", 40933: "上传凭据已使用，请重新保存草稿", 40935: "该版本已发布或正在审核，不能替换应用包", 40936: "Haze 已有待发布版本，请继续处理该草稿", 40938: "审核内容已变化，需要重新提交审核", 40940: "该应用 UUID 仍在 Haze 登记（包括已删除应用），请先在 Haze 处理原登记后再上传" };
  const compatibility = record(data.compatibility).errors;
  const details = Array.isArray(compatibility) ? compatibility.filter((v): v is string => typeof v === "string").slice(0, 5) : [];
  const validation = Array.isArray(data.errors) ? data.errors : Array.isArray(response.detail) ? response.detail : [];
  const fields: Record<string, string> = { body: "资料", query: "参数", file: "文件", type: "类型", target: "发布目标", name: "应用名称", code: "Slug", version: "版本", category_id: "业务分类", tags: "能力标签", description: "描述", package_upload_token: "应用包上传凭据", documentation_upload_token: "文档上传凭据", icon_upload_token: "图标上传凭据", base_revision: "资料版本", visibility: "可见范围", changelog: "更新说明" };
  const reasons: Record<string, string> = { missing: "必填", extra_forbidden: "接口不接受此字段", string_pattern_mismatch: "格式不符合要求", string_too_long: "内容过长", string_too_short: "内容过短", too_long: "数量超出限制", literal_error: "选项不受支持", enum: "选项不受支持", int_parsing: "需要整数", int_type: "需要整数", string_type: "需要文本", list_type: "需要列表", json_invalid: "JSON 格式无效" };
  for (const issue of validation.slice(0, 5)) {
    const error = record(issue);
    const location = Array.isArray(error.loc) ? error.loc.map(v => typeof v === "number" ? `第 ${v + 1} 项` : typeof v === "string" ? fields[v] ?? "字段" : "字段").join(" / ") : "字段";
    details.push(`${location}：${typeof error.type === "string" ? reasons[error.type] ?? "值不符合接口要求" : "值不符合接口要求"}`);
  }
  const stage = path.startsWith("/api/developer/uploads/package") ? "上传应用包" : path.startsWith("/api/developer/uploads/documentation") ? "上传说明文档" : path.startsWith("/api/developer/uploads/icon") ? "上传图标" : "";
  const detail = details.join("；").replace(/haze_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 800);
  return new HazePublishError(`${stage ? `${stage}：` : ""}${code === undefined ? labels[status] ?? "Haze 发布服务暂时不可用" : codes[code] ?? labels[status] ?? "Haze 发布服务暂时不可用"}${detail ? `：${detail}` : ""}`, status >= 400 ? status : 502, code);
}
export interface HazePublishingClient {
  request<T>(path: string, method?: string, body?: Record<string, unknown>, key?: string): Promise<T>;
  upload(kind: "package" | "documentation" | "icon", bytes: Buffer, name: string, mime: string): Promise<{ upload_token: string; sha256?: string; compatibility?: { compatible: boolean; errors?: string[] } }>;
}

/** No credential is persisted or returned to the browser/model. OAuth remains read-only. */
export async function hazePublishingClient(issuer: string, subject: string, check: () => void): Promise<HazePublishingClient> {
  check();
  const { refreshMarketplaceSession } = await import("./auth/marketplace");
  const auth = await refreshMarketplaceSession();
  if (!auth?.session.accessToken || auth.session.principal.subject !== subject) throw new AutomationAppError("请重新登录 Haze 后发布", 401);
  check();
  async function fetchData<T>(path: string, init: RequestInit, token: string): Promise<T> {
    check();
    if (!path.startsWith("/api/") || path.includes("\\") || path.includes("..") || path.startsWith("//")) throw new AutomationAppError("Haze 发布请求地址无效");
    let response: Response;
    try { response = await fetch(`${issuer}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000) }); }
    catch { check(); throw new HazePublishError("连接 Haze 失败或超时；提交结果可能尚未确认，请使用恢复操作", 502); }
    check();
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.data === undefined) {
      throw hazePublishFailure(response.status, payload, path);
    }
    return payload.data as T;
  }
  const secret = await fetchData<{ key: string }>("/api/auth/me/mcp-credential", {}, auth.session.accessToken);
  if (typeof secret.key !== "string" || !secret.key.startsWith("haze_")) throw new AutomationAppError("Haze 未返回有效个人凭证", 502);
  const credential = secret.key;
  return {
    request: <T>(path: string, method = "GET", body?: Record<string, unknown>, key?: string) => fetchData<T>(path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, credential),
    upload: async (kind, bytes, name, mime) => {
      const upload = await hazeUploadBody(bytes, name, mime);
      return fetchData(`/api/developer/uploads/${kind}${kind === "package" ? "?type=plugin&target=eureka" : ""}`, { method: "POST", ...upload }, credential);
    },
  };
}

export async function readPublishContext(client: HazePublishingClient): Promise<PublishContext> {
  const context = await client.request<PublishContext>("/api/developer/publish-context");
  if (!Number.isSafeInteger(context?.user?.id) || !context.actions || !Array.isArray(context.categories) || !context.field_rules || !context.uploads || ![context.uploads.package_max_bytes, context.uploads.documentation_max_bytes, context.uploads.icon_max_bytes].every(n => Number.isSafeInteger(n) && n > 0 && n <= 50 * 1024 * 1024)) throw new AutomationAppError("Haze 发布接口版本不兼容，请检查服务更新和数据库迁移", 502);
  if (!context.actions.read) throw new AutomationAppError("当前 Haze 用户没有开发者读取权限", 403);
  return context;
}
