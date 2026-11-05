import lockfile from "proper-lockfile";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { AutomationAppError } from "./automation-app-package";
export const appLeasePath = (directory: string) => join(directory, "execution-lease");
const runLeaseId = (id: string) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
const runLeasePath = (directory: string, id: string) => join(directory, "execution-leases", id);
export async function appHasLease(directory: string, runId?: string) {
  if (runId !== undefined) {
    if (!runLeaseId(runId)) throw new AutomationAppError("运行占用引用无效。");
    return lockfile.check(runLeasePath(directory, runId), { realpath: false, stale: 15000 });
  }
  if (await lockfile.check(appLeasePath(directory), { realpath: false, stale: 15000 })) return true;
  let names: string[];
  try { names = await readdir(join(directory, "execution-leases")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  for (const name of names) {
    const id = name.endsWith(".lock") ? name.slice(0, -5) : "";
    if (runLeaseId(id) && await lockfile.check(runLeasePath(directory, id), { realpath: false, stale: 15000 })) return true;
  }
  return false;
}
export async function assertAppIdle(directory: string) {
  if (await appHasLease(directory)) throw new AutomationAppError("此应用正在运行或停止中，请结束运行后再卸载或清理数据。", 409);
}
export async function takeAppLease(directory: string, onLost: () => void = () => {}, runId?: string) {
  if (runId !== undefined && !runLeaseId(runId)) throw new AutomationAppError("运行占用引用无效。");
  try { return await lockfile.lock(runId ? runLeasePath(directory, runId) : appLeasePath(directory), { realpath: false, stale: 15000, update: 3000, retries: 0, onCompromised: onLost }); }
  catch { throw new AutomationAppError("此应用已有运行，或上次服务退出后的占用尚在清理，请稍后刷新。", 409); }
}
