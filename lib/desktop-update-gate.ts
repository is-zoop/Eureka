import { timingSafeEqual } from "node:crypto";

const globals = globalThis as typeof globalThis & { __eurekaDesktopInstalling?: boolean; __eurekaDesktopAdmissions?: number };
export function assertDesktopUpdateIdle() {
  if (globals.__eurekaDesktopInstalling) throw new Error("Eureka 正在安装更新，请重新打开应用后再试。");
}
export function authorizeDesktopUpdate(token: string | null) {
  const expected = process.env.EUREKA_DESKTOP_UPDATE_TOKEN;
  if (!expected || !token) return false;
  const actual = Buffer.from(token), wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
export async function withDesktopUpdateAdmission<T>(operation: () => Promise<T>): Promise<T> {
  assertDesktopUpdateIdle();
  globals.__eurekaDesktopAdmissions = (globals.__eurekaDesktopAdmissions ?? 0) + 1;
  try { return await operation(); }
  finally { globals.__eurekaDesktopAdmissions = (globals.__eurekaDesktopAdmissions ?? 1) - 1; }
}
export function setDesktopUpdateDrain(installing: boolean) {
  globals.__eurekaDesktopInstalling = installing;
  if (!installing) return;
  // Inspect existing runtimes only; never construct a session for preflight.
  const runtimes = globalThis as typeof globalThis & {
    __piSessions?: Map<string, { isRunning(): boolean }>;
    __piStartLocks?: Map<string, unknown>;
    __eurekaAppRuns?: { live: Map<string, unknown> };
  };
  if (globals.__eurekaDesktopAdmissions || runtimes.__piStartLocks?.size || [...(runtimes.__piSessions?.values() ?? [])].some(session => session.isRunning()) || runtimes.__eurekaAppRuns?.live.size) {
    globals.__eurekaDesktopInstalling = false;
    throw new Error("仍有聊天或自动化任务正在运行，请结束任务后再安装更新。");
  }
}
