import type { TranslationParams } from "./i18n/types";

type Translate = (key: string, params?: TranslationParams) => string;
export type ExtensionErrorDescription = { message: string; details?: string };

const knownErrors: Record<string, string> = {
  "Access denied": "accessDenied",
  "Untrusted API request": "untrustedRequest",
  "Content-Type must be application/json": "jsonRequired",
  "Installed skill not found": "skillNotFound",
  "This skill cannot be uninstalled here": "skillUninstallUnavailable",
  "Invalid skill installation record": "skillRecordInvalid",
  "Skill installation changed. Refresh and try again.": "skillInstallationChanged",
  "file not found": "fileNotFound",
  "This skill cannot be updated automatically": "skillUpdateUnsupported",
  "This lock entry cannot be checked automatically.": "skillUpdateUnsupported",
  "Remote skill path was not found.": "remoteSkillNotFound",
  "skills.sh did not return a version hash.": "versionUnavailable",
  "Invalid Git tree hash": "versionUnavailable",
  "Package is configured but not installed yet.": "packageMissing",
  "Plugin unavailable": "pluginUnavailable",
  "Capability not found or unavailable": "capabilityUnavailable",
  "HTTP MCP does not support update": "httpUpdateUnsupported",
  "Only MCP supports runtime configuration": "connectorConfigOnly",
  "Install failed": "installFailed",
  "No skills found": "noSkills",
  "unauthenticated": "unauthenticated",
  "forbidden": "accessDenied",
  "Server 名称只能包含字母、数字、点、下划线和连字符": "connectorName",
  "Stdio Server 必须提供命令": "connectorCommand",
  "HTTP Server 必须提供合法的 http(s) URL": "connectorUrl",
  "找不到要删除的 Server": "connectorNotFound",
  "找不到要更新的 Server": "connectorNotFound",
  "缺少 Server 配置": "connectorConfigMissing",
  "同名 Server 已存在": "connectorExists",
};

/** Localize extension feedback at presentation time; preserve unknown tool output as details. */
export function describeExtensionError(error: unknown, t: Translate): ExtensionErrorDescription {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim().replace(/^(?:Error|TypeError):\s*/i, "");
  const text = (key: string, params?: TranslationParams) => t(`extensions.errors.${key}`, params);
  const known = knownErrors[message];
  if (known) return { message: text(known) };
  if (/^Project resources must be trusted before (?:modifying|installing) project (?:plugins|skills|capabilities)$/i.test(message)) {
    return { message: text("projectTrustRequired") };
  }
  if (/^(?:Failed to fetch|fetch failed|NetworkError.*|Network request failed|Load failed)$/i.test(message)) return { message: text("network") };
  if (/timeout|timed out|ETIMEDOUT|AbortError|aborted/i.test(message)) return { message: text("timeout"), details: raw };
  const http = message.match(/^(?:skills\.sh search failed:\s*)?HTTP (\d{3})$/i);
  if (http) return { message: text(http[1] === "401" ? "httpAuth" : http[1] === "403" ? "httpForbidden" : http[1] === "404" ? "httpNotFound" : http[1] === "429" ? "httpRateLimit" : "http", { status: http[1] }) };
  if (/Unexpected (?:token|end)|JSON.*(?:parse|position)|not valid JSON/i.test(message)) return { message: text("invalidResponse"), details: raw };
  const command = message.match(/(?:failed with code|exited with (?:code|status))\s+(-?\d+)/i);
  if (command) return { message: text("commandFailed", { code: command[1] }), details: raw };
  if (/\bE404\b|npm (?:ERR!|error).*404|package.*not found/i.test(message)) return { message: text("packageNotFound"), details: raw };
  if (/\b(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN)\b/.test(message)) return { message: text("network"), details: raw };
  if (/\b(?:EACCES|EPERM)\b/.test(message)) return { message: text("filePermission"), details: raw };
  if (/\bENOENT\b/.test(message)) return { message: text("fileOrCommandMissing"), details: raw };
  const required = message.match(/^(.+?) (?:is |are )?required$/i);
  if (required) return { message: text("required", { fields: required[1] }) };
  if (/^(?:invalid |unsupported action|package and scope must be provided together)/i.test(message)) return { message: text("invalidRequest"), details: raw };
  // Server-side localized messages remain readable; arbitrary upstream prose is kept for diagnosis.
  if (/[\u3400-\u9fff]/.test(message)) return { message };
  return { message: text("unknown"), ...(raw.trim() ? { details: raw } : {}) };
}
