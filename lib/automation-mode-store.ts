import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { assertCreationIdentity } from "./automation-creation-runtime";
import { AUTOMATION_MODE_ENTRY, parseAutomationTaskRef, readAutomationMode, sameAutomationTask, type AutomationTaskRef, type AutomationModeRecord } from "./automation-mode";
export interface AutomationTaskDocument extends AutomationModeRecord { version: 1; createdAt: string; goal: string }
interface Manager { getSessionId(): string; getBranch(): { type: string; customType?: string; data?: unknown }[]; appendCustomEntry(type: string, data: unknown): unknown }
export function assertAutomationTaskIdentity(task: AutomationTaskRef) { const ref = parseAutomationTaskRef(task); assertCreationIdentity({ version: 1, ownerKey: ref.ownerKey, runtimeId: ref.runtimeId }); }
export function taskDirectory(task: AutomationTaskRef) { const ref = parseAutomationTaskRef(task); return join(getAgentDir(), "app-data", ref.ownerKey, "creation", ref.id); }
export async function readAutomationTask(task: AutomationTaskRef): Promise<AutomationTaskDocument | null> {
  assertAutomationTaskIdentity(task);
  try { const v = JSON.parse(await readFile(join(taskDirectory(task), "task.json"), "utf8")) as AutomationTaskDocument; const ref = parseAutomationTaskRef(v.task); if (v.version !== 1 || ref.id !== task.id || ref.ownerKey !== task.ownerKey || ref.runtimeId !== task.runtimeId || typeof v.sessionId !== "string" || !["active", "paused", "exited"].includes(v.status)) throw new Error(); assertAutomationTaskIdentity(task); return v; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("自动化任务已变化或不可读取，请重新选择命令。"); }
}
export async function changeAutomationTask(manager: Manager, raw: unknown, status: AutomationModeRecord["status"], goal?: string) {
  const task = parseAutomationTaskRef(raw); assertAutomationTaskIdentity(task); const directory = taskDirectory(task);
  if(status!=="active"){await(await import("./automation-authoring")).stopAuthor(task).catch(()=>{});}
  if (status !== "active" && !await readAutomationTask(task)) return null;
  await mkdir(directory, { recursive: true, mode: 0o700 }); const file = join(directory, "task.json"), temp = `${file}.${randomUUID()}.tmp`;
  const unlock = await lockfile.lock(file, { realpath: false, retries: { retries: 4, minTimeout: 30, maxTimeout: 100 } });
  try {
    const old = await readAutomationTask(task); if (old && old.sessionId !== manager.getSessionId()) throw new Error("该自动化任务属于其他会话。");
    if (!old && (status !== "active" || goal === undefined)) return null;
    if (old?.status === "exited") { if(status === "active")throw new Error("该创建任务已退出，请重新选择自动化命令。"); return old; }
    if (old && JSON.stringify(old.task.baseApp) !== JSON.stringify(task.baseApp)) throw new Error("创建任务的原应用引用已变化。");
    if (!old && task.baseApp) { const {AutomationAppStore}=await import("./automation-app-store");const app=await new AutomationAppStore(getAgentDir(),task.ownerKey,()=>assertAutomationTaskIdentity(task)).find(task.baseApp.id);if(!app||app.revision!==task.baseApp.revision||app.activeVersion!==task.baseApp.version)throw new Error("原应用版本已变化，请重新打开修改。"); }
    const now = new Date().toISOString(), document: AutomationTaskDocument = { version: 1, task, sessionId: manager.getSessionId(), status, updatedAt: now, createdAt: old?.createdAt ?? now, goal: old?.goal ?? String(goal).slice(0, 10000) };
    await writeFile(temp, JSON.stringify(document, null, 2), { flag: "wx", mode: 0o600 }); assertAutomationTaskIdentity(task); await rename(temp, file);
    // A late pause from another page must not replace a newer task's session marker.
    if (status === "active" || sameAutomationTask(readAutomationMode(manager.getBranch())?.task, task)) manager.appendCustomEntry(AUTOMATION_MODE_ENTRY, { task, sessionId: document.sessionId, status, updatedAt: now } satisfies AutomationModeRecord);
    return document;
  } finally { try { await rm(temp, { force: true }); } finally { await unlock(); } }
}
const shared = globalThis as typeof globalThis & { __eurekaAutomationIntake?: WeakMap<object, AutomationTaskDocument>; __eurekaAutomationQueueGenerations?: WeakMap<object, Map<string, number>> };
const active = shared.__eurekaAutomationIntake ??= new WeakMap<object, AutomationTaskDocument>();
const generations = shared.__eurekaAutomationQueueGenerations ??= new WeakMap<object, Map<string, number>>();
export function automationQueueGeneration(manager: object, task: AutomationTaskRef, cancel = false) { let map = generations.get(manager); if (!map) { map = new Map(); generations.set(manager, map); } const key = `${task.ownerKey}:${task.runtimeId}:${task.id}`, n = (map.get(key) ?? 0) + (cancel ? 1 : 0); if (cancel) map.set(key, n); return n; }
export function activeAutomationTask(manager: object) { return active.get(manager); }
export function bindAutomationTask(manager: object, task: AutomationTaskDocument | null) { if (task) active.set(manager, task); else active.delete(manager); }
