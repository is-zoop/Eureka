/** Task references only. Never put user requirements or credentials in composer storage. */
import {isAppId,isAppVersion} from "./automation-app";
export interface AutomationTaskRef { id: string; ownerKey: string; runtimeId: string; baseApp?: { id: string; revision: number; version: string } }
/** Navigation intent; identity/version are rechecked before creating the task. */
export interface AutomationLaunchRequest { draftKey: string; baseApp?: AutomationTaskRef["baseApp"]; displayName?: string; ownerKey?: string; runtimeId?: string }
export interface AutomationModeRecord { task: AutomationTaskRef; sessionId: string; status: "active" | "paused" | "exited"; updatedAt: string }
export const AUTOMATION_MODE_ENTRY = "eureka_automation_mode";
export function parseAutomationTaskRef(raw: unknown): AutomationTaskRef {
  const v = raw as Partial<AutomationTaskRef> | null;
  if (!v || typeof v.id!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.id) || typeof v.ownerKey!=="string" || !/^[a-f0-9]{64}$/.test(v.ownerKey) || typeof v.runtimeId !== "string" || !v.runtimeId || v.runtimeId.length > 200) throw new Error("自动化任务引用无效，请重新选择自动化命令。");
  if ("baseTool" in v) throw new Error("旧版查询工具已移除，请创建独立应用。");
  if(v.baseApp&&(!isAppId(v.baseApp.id)||!Number.isSafeInteger(v.baseApp.revision)||v.baseApp.revision<1||!isAppVersion(v.baseApp.version)))throw new Error("原应用引用无效。");
  return { id: v.id!, ownerKey: v.ownerKey!, runtimeId: v.runtimeId, ...(v.baseApp?{baseApp:{id:v.baseApp.id,revision:v.baseApp.revision,version:v.baseApp.version}}:{}) };
}
export function readAutomationMode(entries: readonly { type: string; customType?: string; data?: unknown }[]): AutomationModeRecord | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]; if (e.type !== "custom" || e.customType !== AUTOMATION_MODE_ENTRY) continue;
    try { const v = e.data as AutomationModeRecord; if (!["active", "paused", "exited"].includes(v.status) || typeof v.sessionId !== "string" || !Number.isFinite(Date.parse(v.updatedAt))) return null; return { task: parseAutomationTaskRef(v.task), sessionId: v.sessionId, status: v.status, updatedAt: v.updatedAt }; } catch { return null; }
  }
  return null;
}
export function sameAutomationTask(a: AutomationTaskRef | null | undefined, b: AutomationTaskRef | null | undefined) { return Boolean(a && b && a.id === b.id && a.ownerKey === b.ownerKey && a.runtimeId === b.runtimeId); }
export {AUTOMATION_AUTHOR_TOOLS as AUTOMATION_INTAKE_TOOLS} from "./automation-authoring-guide";
export {AUTOMATION_AUTHOR_SYSTEM as AUTOMATION_INTAKE_SYSTEM} from "./automation-authoring-guide";
