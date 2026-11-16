import { createHash } from "node:crypto";
import { isAppId, type AutomationAppEditValues, type AutomationAppPresentation } from "./automation-app";
import { AutomationAppError } from "./automation-app-package";

export const APP_ICON_MAX = 2 * 1024 * 1024;
const iconTypes = ["image/png", "image/jpeg", "image/webp"];

export function parseAppPresentation(value: unknown): AutomationAppPresentation {
  const v = value as AutomationAppPresentation;
  if (!v || !isAppId(v.revision) || typeof v.description !== "string" || v.description.length > 300 ||
    v.categoryId !== null && (!Number.isSafeInteger(v.categoryId) || v.categoryId < 1) ||
    !Array.isArray(v.tags) || v.tags.length > 30 || v.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 50) ||
    v.icon && (!/^[a-f0-9]{64}$/.test(v.icon.digest) || !iconTypes.includes(v.icon.mimeType))) throw new AutomationAppError("应用资料无效");
  return { revision: v.revision, description: v.description, categoryId: v.categoryId, tags: [...v.tags], ...(v.icon ? { icon: { digest: v.icon.digest, mimeType: v.icon.mimeType } } : {}) };
}

export function parseAppEditValues(value: unknown, categories: readonly number[]): AutomationAppEditValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AutomationAppError("应用资料格式无效");
  const v = value as AutomationAppEditValues;
  if (Object.keys(v).some(key => !["displayName", "description", "categoryId", "tags", "icon"].includes(key))) throw new AutomationAppError("应用资料包含不支持的字段");
  if (typeof v.displayName !== "string" || !v.displayName.trim() || v.displayName.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(v.displayName)) throw new AutomationAppError("请填写 1～100 字的应用名称");
  if (typeof v.description !== "string" || v.description.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.description)) throw new AutomationAppError("描述不能超过 300 字");
  if (v.categoryId !== null && (!Number.isSafeInteger(v.categoryId) || !categories.includes(v.categoryId))) throw new AutomationAppError("请选择 Haze 已有业务分类");
  if (!Array.isArray(v.tags) || v.tags.length > 30 || v.tags.some(tag => typeof tag !== "string" || tag.length > 50 || /[\x00-\x1f]/.test(tag))) throw new AutomationAppError("能力标签数量或长度超限");
  const result: AutomationAppEditValues = { displayName: v.displayName.trim(), description: v.description.trim(), categoryId: v.categoryId, tags: [...new Set(v.tags.map(tag => tag.trim()).filter(Boolean))] };
  if (v.icon === null) result.icon = null;
  else if (v.icon !== undefined) { readAppEditIcon(v.icon); result.icon = { name: v.icon.name, type: v.icon.type, data: v.icon.data }; }
  return result;
}

export function readAppEditIcon(icon: NonNullable<AutomationAppEditValues["icon"]>) {
  if (!icon || typeof icon.name !== "string" || icon.name.length > 200 || !iconTypes.includes(icon.type) || typeof icon.data !== "string" || !icon.data.length || icon.data.length > Math.ceil(APP_ICON_MAX / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(icon.data)) throw new AutomationAppError("图标格式或大小无效");
  const bytes = Buffer.from(icon.data, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!bytes.length || bytes.length > APP_ICON_MAX || !(icon.type === "image/png" && png || icon.type === "image/jpeg" && jpeg || icon.type === "image/webp" && webp)) throw new AutomationAppError("请选择有效的 PNG、JPEG 或 WebP 图标");
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex"), mimeType: icon.type as NonNullable<AutomationAppPresentation["icon"]>["mimeType"] };
}
