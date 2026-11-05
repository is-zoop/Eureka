import { createHash } from "node:crypto";
import { compareAppVersions } from "./automation-app-version";
import { AutomationAppError, type AutomationAppPackage } from "./automation-app-package";

export interface PublicationDraft {
  name: string; code: string; description: string; categoryId: number | null; tags: string[];
  readme: string; quickStart: string; changelog: string;
  icon?: { name: string; type: string; data: string };
}
export interface PublishContext {
  user: { id: number; name: string };
  actions: Record<"read" | "create" | "update" | "version" | "submit_review" | "publish", boolean>;
  categories: { id: number; name: string }[];
  field_rules: Record<string, { maxLength?: number; minLength?: number; maxItems?: number; pattern?: string }>;
  uploads: { package_max_bytes: number; documentation_max_bytes: number; icon_max_bytes: number; token_ttl_seconds: number; icon_formats: string[] };
}
export interface PublishedCapability {
  id: number; owner_id: number; code: string; name: string; description: string | null;
  category_id: number | null; tags: string[]; type: string; version: string; status: string;
  revision: number; is_listed: boolean; published_version: string | null; pending_version: string | null;
  pending_status: string | null; review_comment: string | null; eureka_automation_id: string | null;
  package: { sha256?: string } | null;
  documentation?: { sha256?: string } | null; icon?: string | null;
}
export interface PublicationRequest {
  key: string; path: string; method: "POST" | "PATCH"; body: Record<string, unknown>;
  operation: "save" | "submit-review" | "publish"; digest: string; draftHash: string; version: string;
}
export interface PublicationRecord {
  schemaVersion: 1; issuer: string; subject: string; appId: string; draft: PublicationDraft;
  capabilityId?: number; remote?: PublishedCapability;
  saved?: { digest: string; draftHash: string; version: string; archiveSha256: string; contentHash: string };
  baseline?: { version: string; name: string; description: string; readme: string; fileHashes: Record<string, string> };
  pending?: PublicationRequest;
  metadataRevision?: string;
}
export interface PublicationView {
  ownerKey: string; runtimeId: string; context: PublishContext; draft: PublicationDraft;
  remote: PublishedCapability | null; version: string; digest: string; retryPending: boolean;
  saved: boolean; canSave: boolean; canSubmit: boolean; canPublish: boolean;
}
export const publicationHash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const archiveHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const remotePublicationHash = (remote: PublishedCapability) => publicationHash({ name: remote.name, code: remote.code, description: remote.description, categoryId: remote.category_id, tags: remote.tags, documentation: remote.documentation?.sha256, icon: remote.icon });

/** Keep storage paths and arbitrary runtime config out of local responses and records. */
export function publicationRemote(raw: PublishedCapability): PublishedCapability {
  return {
    id: raw.id, owner_id: raw.owner_id, code: raw.code, name: raw.name, description: raw.description,
    category_id: raw.category_id, tags: raw.tags, type: raw.type, version: raw.version, status: raw.status,
    revision: raw.revision, is_listed: raw.is_listed, published_version: raw.published_version, pending_version: raw.pending_version,
    pending_status: raw.pending_status, review_comment: raw.review_comment, eureka_automation_id: raw.eureka_automation_id,
    package: raw.package ? { sha256: raw.package.sha256 } : null,
    documentation: raw.documentation ? { sha256: raw.documentation.sha256 } : null, icon: raw.icon,
  };
}

export function initialPublicationDraft(pkg: AutomationAppPackage, remote?: PublishedCapability): PublicationDraft {
  return {
    name: remote?.name ?? pkg.manifest.displayName,
    code: remote?.code ?? (/^[a-z0-9-]{3,50}$/.test(pkg.manifest.name) ? pkg.manifest.name : `app-${pkg.manifest.automation.id}`),
    description: remote?.description ?? pkg.manifest.description.slice(0, 300),
    categoryId: remote?.category_id ?? null, tags: remote?.tags ?? ["自动化"],
    readme: pkg.readme, quickStart: "", changelog: "",
  };
}

/** Validate the entire editable draft, including the independently uploaded documents. */
export function parsePublicationDraft(value: unknown, context: PublishContext, complete = false): PublicationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AutomationAppError("发布资料格式无效");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["name", "code", "description", "categoryId", "tags", "readme", "quickStart", "changelog", "icon"].includes(key))) throw new AutomationAppError("发布资料包含不支持的字段");
  function text(key: string, max: number) {
    const v = raw[key];
    if (typeof v !== "string" || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) throw new AutomationAppError(`发布字段 ${key} 缺失或过长`);
    return v.trim();
  }
  const name = text("name", Math.min(100, context.field_rules.name?.maxLength ?? 100));
  const code = text("code", Math.min(50, context.field_rules.code?.maxLength ?? 50));
  const description = text("description", Math.min(300, context.field_rules.description?.maxLength ?? 300));
  if (code && !/^[a-z0-9-]{3,50}$/.test(code)) throw new AutomationAppError("Slug 需要 3～50 位小写字母、数字或中划线");
  if (raw.categoryId !== null && (!Number.isSafeInteger(raw.categoryId) || !context.categories.some(c => c.id === raw.categoryId))) throw new AutomationAppError("请选择 Haze 已有业务分类");
  if (!Array.isArray(raw.tags) || raw.tags.length > Math.min(30, context.field_rules.tags?.maxItems ?? 30) || raw.tags.some(v => typeof v !== "string" || v.length > 50 || /[\x00-\x1f]/.test(v))) throw new AutomationAppError("标签数量或长度超限");
  const tags = [...new Set((raw.tags as string[]).map(v => v.trim()).filter(Boolean))];
  const result: PublicationDraft = { name, code, description, categoryId: raw.categoryId as number | null, tags, readme: text("readme", 200000), quickStart: text("quickStart", 100000), changelog: text("changelog", 5000) };
  if (raw.icon !== undefined) {
    const icon = raw.icon as PublicationDraft["icon"];
    if (!icon || typeof icon.name !== "string" || icon.name.length > 200 || !["image/png", "image/jpeg", "image/webp"].includes(icon.type) || typeof icon.data !== "string" || icon.data.length > Math.ceil(context.uploads.icon_max_bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(icon.data) || !icon.data.length || Buffer.from(icon.data, "base64").length > context.uploads.icon_max_bytes) throw new AutomationAppError("图标格式或大小无效");
    result.icon = { name: icon.name, type: icon.type, data: icon.data };
  }
  if (complete && (!name || !code || !description || !result.categoryId || !result.readme || !result.quickStart)) throw new AutomationAppError("请填写名称、Slug、描述、业务分类、说明文档和快速开始");
  return result;
}

export function publicationSaveMode(remote: PublishedCapability | undefined, version: string): "create" | "update" | "version" {
  if (!remote) return "create";
  if (remote.pending_version || !remote.published_version) {
    if (remote.version !== version) throw new AutomationAppError("Haze 已有不同版本的待发布草稿，请先在 Haze 处理该版本", 409);
    if (!["draft", "rejected"].includes(remote.pending_status ?? remote.status)) throw new AutomationAppError("当前版本已送审，请等待审核结果", 409);
    return "update";
  }
  if (compareAppVersions(version, remote.published_version) <= 0 || compareAppVersions(version, remote.version) <= 0) throw new AutomationAppError("请先通过 AI 修改保存更高版本的应用，再发布新版", 409);
  return "version";
}
