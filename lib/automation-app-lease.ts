import lockfile from "proper-lockfile";
import { join } from "node:path";
import { AutomationAppError } from "./automation-app-package";
export const appLeasePath = (directory: string) => join(directory, "execution-lease");
export async function appHasLease(directory: string) { return lockfile.check(appLeasePath(directory), { realpath: false, stale: 15000 }); }
export async function assertAppIdle(directory: string) {
  if (await appHasLease(directory)) throw new AutomationAppError("此应用正在运行或停止中，请结束运行后再卸载或清理数据。", 409);
}
export async function takeAppLease(directory: string, onLost: () => void = () => {}) {
  try { return await lockfile.lock(appLeasePath(directory), { realpath: false, stale: 15000, update: 3000, retries: 0, onCompromised: onLost }); }
  catch { throw new AutomationAppError("此应用已有运行，或上次服务退出后的占用尚在清理，请稍后刷新。", 409); }
}
