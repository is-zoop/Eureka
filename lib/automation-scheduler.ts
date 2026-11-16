import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { automationAppAccess } from "./automation-app-server";
import { isAppId, isAppVersion } from "./automation-app";
import { appActionDetail } from "./automation-app-actions";
import { AutomationAppError } from "./automation-app-package";
import { appJsonValue, appParameters, appRunActive } from "./automation-app-run";
import { appHasLease } from "./automation-app-lease";
import { getAppRun, readAppConfiguration, startAppRun } from "./automation-app-runtime";
import { readBusinessAi } from "./automation-business-ai-store";
import { checkpointHash } from "./automation-checkpoints";
import { relativeAppDate, type RelativeDate } from "./automation-form";
import { nextScheduleAt, parseScheduleTiming, type AppSchedule, type ScheduleEvent } from "./automation-schedule";

type Access = Awaited<ReturnType<typeof automationAppAccess>>;
interface Registry { schemaVersion: 1; workspaceId: string; revision: number; plans: AppSchedule[] }
const localRequest = (path: string) => new Request(`http://localhost${path}`, { headers: { host: "localhost" } });
async function saveRegistry(auth: Access, registry: Registry) {
  // Bound old trigger messages before they can crowd out current plan settings.
  while (Buffer.byteLength(JSON.stringify(registry)) >= 4 * 1024 * 1024) {
    const longest = registry.plans.reduce<AppSchedule | undefined>((selected, plan) => plan.history.length > (selected?.history.length ?? 1) ? plan : selected, undefined);
    if (!longest) break; longest.history.pop();
  }
  if (Buffer.byteLength(JSON.stringify(registry)) >= 4 * 1024 * 1024) throw new AutomationAppError("定时计划记录超过 4 MiB，请减少计划数量或将大量参数改为文件输入。", 400);
  await auth.store.privateJson(join(auth.store.dataRoot, "scheduler", "plans.json"), registry);
}
function event(plan: AppSchedule, entry: ScheduleEvent) { plan.history = [entry, ...plan.history].slice(0, 20); plan.updatedAt = entry.at; plan.revision++; }
async function locked<T>(auth: Access, work: (registry: Registry) => Promise<T>, write = false) {
  const root = join(auth.store.dataRoot, "scheduler"), path = join(root, "plans.json"); await auth.store.ensureDataDirectory(root); await auth.store.managedPath(path);
  const release = await lockfile.lock(join(root, "plans"), { realpath: false, stale: 30000, update: 5000, retries: { retries: 10, minTimeout: 50, maxTimeout: 200 } });
  try {
    let registry: Registry;
    try { registry = JSON.parse((await auth.store.privateBytes(path, 4 * 1024 * 1024)).toString("utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; registry = { schemaVersion: 1, workspaceId: auth.runtimeId, revision: 0, plans: [] }; }
    if (registry.schemaVersion !== 1 || registry.workspaceId !== auth.runtimeId || !Array.isArray(registry.plans) || registry.plans.length > 100 || registry.plans.some(p => !isAppId(p.id) || !isAppId(p.appId) || !isAppVersion(p.version) || !/^[a-f0-9]{64}$/.test(p.digest) || !Array.isArray(p.history))) throw new AutomationAppError("本地定时记录损坏或工作区已变化。", 409);
    auth.assertIdentity(); const result = await work(registry); auth.assertIdentity();
    if (write) { registry.revision++; await saveRegistry(auth, registry); }
    return result;
  } finally { await release(); }
}
async function browserHash(auth: Access, id: string) {
  try { return checkpointHash(JSON.parse((await auth.store.privateBytes(join(auth.store.dataDirectory(id), "browser-settings.json"), 512 * 1024)).toString("utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return checkpointHash(null); throw error; }
}
export async function listSchedules(auth: Access, appId?: string) { return locked(auth, async registry => registry.plans.filter(p => !appId || p.appId === appId)); }
export async function createSchedule(auth: Access, value: unknown, now = Date.now()) {
  const v = value as { appId: string; version: string; actionId: string; values: unknown; dates: Record<string, RelativeDate>; timing: unknown };
  if (!v || !isAppId(v.appId) || !isAppVersion(v.version) || typeof v.actionId !== "string") throw new AutomationAppError("定时应用或功能引用无效。", 400);
  const detail = appActionDetail(await auth.store.detail(v.appId, v.version), v.actionId);
  let timing; try { timing = parseScheduleTiming(v.timing); } catch (error) { throw new AutomationAppError((error as Error).message, 400); }
  const nextAt = nextScheduleAt(timing, now);
  if (detail.install.disabled || !nextAt) throw new AutomationAppError("应用已停用，或运行时间已过去。", 400);
  const dates = v.dates ?? {}; if (typeof dates !== "object" || Array.isArray(dates) || Object.entries(dates).some(([id, rule]) => !detail.ui.fields.some(f => f.id === id && f.type === "date") || !["today", "yesterday", "tomorrow"].includes(rule))) throw new AutomationAppError("动态日期设置无效。", 400);
  let values; try { values = appParameters(detail.ui, v.values, true); appJsonValue(values, 256 * 1024); } catch (error) { throw new AutomationAppError((error as Error).message, 400); }
  const stamp = new Date(now).toISOString(), aiHash = checkpointHash((await readBusinessAi(auth.store, v.appId)).settings), browsers = await browserHash(auth, v.appId);
  const plan: AppSchedule = { id: randomUUID(), appId: v.appId, appName: detail.manifest.displayName, version: v.version, digest: detail.install.versions.find(item => item.version === v.version)!.digest, actionId: v.actionId, actionLabel: detail.ui.buttons[0]?.label ?? v.actionId, values, dates: structuredClone(dates), aiHash, browserHash: browsers, timing, nextAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true, revision: 1, createdAt: stamp, updatedAt: stamp, history: [] };
  return locked(auth, async registry => {
    if (registry.plans.length >= 100) throw new AutomationAppError("最多保存 100 个定时计划。", 400);
    if (Buffer.byteLength(JSON.stringify([...registry.plans, plan].map(p => ({ ...p, history: [] })))) > 2 * 1024 * 1024) throw new AutomationAppError("计划参数已达到本地容量上限，请减少计划或使用文件输入。", 400);
    registry.plans.push(plan); return plan;
  }, true);
}
export async function changeSchedule(auth: Access, id: string, revision: number, action: "enable" | "pause" | "delete", now = Date.now()) {
  return locked(auth, async registry => {
    const plan = registry.plans.find(p => p.id === id); if (!plan || plan.revision !== revision) throw new AutomationAppError("计划已变化，请刷新后再操作。", 409);
    if (action === "delete") { registry.plans = registry.plans.filter(p => p.id !== id); return null; }
    if (action !== "pause" && action !== "enable") throw new AutomationAppError("计划操作无效。", 400);
    plan.enabled = action === "enable"; plan.nextAt = plan.enabled ? nextScheduleAt(plan.timing, now) : null;
    if (plan.enabled && !plan.nextAt) throw new AutomationAppError("一次性时间已过去，请重新创建计划。", 400);
    event(plan, { at: new Date(now).toISOString(), status: action }); return plan;
  }, true);
}
/** Claims an occurrence on disk before launch; unknown dispatches are never replayed. */
export async function tickSchedules(now = Date.now(), missed = false) {
  const auth = await automationAppAccess(localRequest("/api/automation/schedules"));
  await locked(auth, async registry => {
    for (const plan of registry.plans) {
      if (!plan.enabled || !plan.nextAt || Date.parse(plan.nextAt) > now) continue;
      const at = new Date(now).toISOString(), due = plan.nextAt;
      plan.nextAt = nextScheduleAt(parseScheduleTiming(plan.timing), now); if (!plan.nextAt) plan.enabled = false;
      if (missed || now - Date.parse(due) > 60000) { event(plan, { at, status: "missed", message: "Eureka 未运行、电脑休眠或触发时间已错过；未补跑。" }); continue; }
      try {
        if (plan.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone) throw new Error("电脑时区已变化，请重新创建计划。");
        const access = await automationAppAccess(localRequest(`/api/automation/apps/${plan.appId}/runtime?version=${encodeURIComponent(plan.version)}`)), detail = await access.store.detail(plan.appId);
        if (detail.install.disabled || detail.manifest.version !== plan.version || detail.install.versions.find(v => v.version === plan.version)?.digest !== plan.digest) throw new Error("应用已停用、卸载或计划版本已变化。");
        if (checkpointHash((await readBusinessAi(access.store, plan.appId)).settings) !== plan.aiHash || await browserHash(access, plan.appId) !== plan.browserHash) throw new Error("业务 AI 或浏览器环境配置已变化，请重新创建计划。");
        if (await appHasLease(detail.dataDirectory)) { event(plan, { at, status: "skipped", message: "应用上一轮尚未结束，本次已跳过。" }); continue; }
        const values = structuredClone(plan.values); for (const [field, rule] of Object.entries(plan.dates)) values[field] = relativeAppDate(rule, new Date(now));
        const runId = randomUUID(); event(plan, { at, status: "starting", runId });
        // Persist this occurrence before invoking the shared runtime. A crash here
        // loses the occurrence instead of risking a duplicate business submission.
        await saveRegistry(auth, registry);
        const config = await readAppConfiguration(access, plan.appId, plan.actionId);
        await startAppRun(access, plan.appId, detail.install.revision, runId, values, config.revision, plan.actionId, { persistConfiguration: false, scheduleId: plan.id, assertScheduledSettings: async () => {
          if (checkpointHash((await readBusinessAi(access.store, plan.appId)).settings) !== plan.aiHash || await browserHash(access, plan.appId) !== plan.browserHash) throw new Error("业务 AI 或浏览器环境配置已变化，请重新创建计划。");
        } });
        plan.history[0].status = "started";
      } catch (error) { plan.enabled = false; plan.nextAt = null; event(plan, { at, status: "paused", message: (error instanceof Error ? error.message : "计划启动失败；未重试。").slice(0, 1000) }); }
    }
  }, true);
}
export async function scheduleRuns(auth: Access, plans: AppSchedule[]) {
  return Promise.all(plans.map(async plan => { const runId = plan.history.find(e => e.runId)?.runId; if (!runId) return plan; try { const run = await getAppRun(auth, plan.appId, runId); return { ...plan, run: { id: run.id, status: run.status, waiting: appRunActive(run.status), error: run.error } }; } catch { return plan; } }));
}
const globals = globalThis as typeof globalThis & { __eurekaScheduleTimer?: ReturnType<typeof setInterval> };
export function startAutomationScheduler() {
  if (globals.__eurekaScheduleTimer) return;
  let busy = false, previous = Date.now(), first = true;
  const tick = async () => { if (busy) return; busy = true; const now = Date.now(), missed = first || now - previous > 60000; first = false; previous = now; try { await tickSchedules(now, missed); } catch (error) { console.error("Local automation scheduler:", error instanceof Error ? error.message : "failed"); } finally { busy = false; } };
  globals.__eurekaScheduleTimer = setInterval(() => void tick(), 15000); globals.__eurekaScheduleTimer.unref?.(); void tick();
}
