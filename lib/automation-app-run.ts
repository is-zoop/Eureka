import type { AutomationAppUi, AutomationAppWorkflow } from "./automation-app";
import type { UserInputQuestion } from "./user-input";
export type AppJson = null | boolean | number | string | AppJson[] | { [key: string]: AppJson };
export interface AppFileRef { grantId: string; relative?: string; label?: string; access?: "read" | "readwrite" }
export interface AppFileGrant { id: string; fieldId: string; path: string; kind: "file" | "directory"; access: "read" | "readwrite"; digest: string }
export interface AppConfiguration { schemaVersion: 1; revision: number; values: Record<string, AppJson> }
export type AppRunStatus = "running" | "waiting-user" | "waiting-browser" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
export interface AppRunEvent { seq: number; runId: string; at: string; kind: "run" | "node" | "log" | "artifact" | "question"; status: string; nodeId?: string; execution?: number; message?: string; inputRef?: string; outputRef?: string }
export interface AppArtifact { id: string; name: string; mediaType: string; size: number }
export interface AppRunRecord {
  schemaVersion: 1; id: string; appId: string; version: string; digest: string; runtimeId: string; serverId: string; serverPid: number; actionId: string;
  actionLabel?: string;
  /** Relative entry pinned at launch; absent on historical runs. */
  entryScript?: string;
  status: AppRunStatus; startedAt: string; finishedAt?: string; error?: string; workflow: AutomationAppWorkflow;
  events: AppRunEvent[]; artifacts: AppArtifact[]; resultRef?: string; resultColumns: AutomationAppUi["results"]["columns"];
  question?: { id: string; questions: UserInputQuestion[] };
  browserApproval?: import("./automation-app-browser").AppBrowserApproval;
  browserSessions?: import("./automation-app-browser-runtime").AppBrowserSession[];
  stepControl?: { mode: "conversation"; pending: import("./automation-step-driver").AppPendingStep[]; current?: import("./automation-step-driver").AppPendingStep };
  isolation?: "run";
}
export const appRunActive = (status: AppRunStatus) => ["running", "waiting-user", "waiting-browser", "cancelling"].includes(status);
export const appRunTerminal = (status: AppRunStatus) => !appRunActive(status);
/** Reading/updating an old run must not move it ahead of newer runs. */
export function newestAppRuns<T extends Pick<AppRunRecord, "id" | "startedAt">>(runs: readonly T[]): T[] {
  return [...runs].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) || a.id.localeCompare(b.id));
}
export function appJsonValue(value: unknown, maxBytes = 1024 * 1024): AppJson {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).length > maxBytes) throw new Error("数据为空或超过单项 1 MiB 限制，请将大文件保存为产物。");
  const result = JSON.parse(encoded) as AppJson;
  // JSON stringify otherwise silently converts non-finite numbers to null.
  const check = (v: unknown, depth: number) => {
    if (depth > 40) throw new Error("数据嵌套过深。");
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("数字必须为有限数值。");
    if (v !== null && typeof v === "object") for (const item of Object.values(v)) check(item, depth + 1);
    else if (!["string", "number", "boolean"].includes(typeof v) && v !== null) throw new Error("仅支持 JSON 数据类型。");
  };
  check(value, 0); return result;
}
export function appParameters(ui: AutomationAppUi, raw: unknown, requireAll: boolean): Record<string, AppJson> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配置必须为对象。");
  const values = raw as Record<string, unknown>, entries: [string, AppJson][] = [];
  for (const field of ui.fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : field.default ?? null;
    if (value === null || value === undefined || value === "") {
      if (requireAll && field.required) throw new Error(`请填写“${field.label}”。`);
      entries.push([field.id, value === "" ? "" : null]); continue;
    }
    let valid = false;
    switch (field.type) {
      case "text": valid = typeof value === "string"; break;
      case "number": case "percentage": valid = typeof value === "number" && Number.isFinite(value); break;
      case "boolean": valid = typeof value === "boolean"; break;
      case "date": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break;
      case "object": valid = typeof value === "object" && !Array.isArray(value); break;
      case "list": valid = Array.isArray(value); break;
      case "file": case "directory": valid = typeof value === "object" && !Array.isArray(value) && typeof (value as AppFileRef).grantId === "string" && /^[a-f0-9-]{36}$/.test((value as AppFileRef).grantId); break;
    }
    if (!valid) throw new Error(`“${field.label}”的类型或格式不正确。`);
    entries.push([field.id, appJsonValue(value)]);
  }
  return Object.fromEntries(entries);
}
