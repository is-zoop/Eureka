import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

/** Use the exact runtime already running Eureka, including the bundled desktop Node. */
export async function automationNodeLaunch(workspace: string) {
  const executable = process.execPath;
  try { if (!(await stat(executable)).isFile()) throw new Error(); }
  catch { throw new Error("Eureka 正在使用的 Node.js 运行文件已不可用，请重启 Eureka 或修复桌面安装；无需另装 Node.js。"); }
  // Creation uses a compact private workspace for both cwd and SDK operations.
  // Retain a short launch fallback for custom stores with unusually long roots.
  for (const directory of automationLaunchDirectories(workspace, executable, process.platform)) {
    try { if ((await stat(directory)).isDirectory()) return { executable, directory }; } catch { /* Try another existing local directory, never PATH search. */ }
  }
  throw new Error("自动化启动目录不可用或路径过长，未启动脚本。");
}
export function automationLaunchDirectories(workspace: string, executable: string, platform: string) {
  return [...new Set([workspace, dirname(executable)].filter(value => isAbsolute(value) && (platform !== "win32" || value.length < 240)))];
}
export function automationStartError(error: unknown, stage: "launch" | "ipc" = "launch") {
  const code=(error as NodeJS.ErrnoException)?.code;
  const label = stage === "ipc" ? "自动化进程通信失败" : "自动化控制进程启动失败";
  return `${label}${typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? `（${code}）` : ""}；脚本启动尚未确认完成。`;
}

/** Declare directory descendants explicitly; do not depend on Node's startup stat
 * turning an existing (possibly long Windows) directory into a recursive grant. */
export function automationFilePermissionFlags(readable: { path: string; kind: "file" | "directory" }[], writable: { path: string; kind: "file" | "directory" }[]) {
  const flags = (access: "read" | "write", paths: typeof readable) => [...new Set(paths.flatMap(item => {
    if (!isAbsolute(item.path) || item.path.includes("*")) throw new Error("自动化文件授权路径无效。");
    return (item.kind === "directory" ? [item.path, join(item.path, "*")] : [item.path]).map(path => `--allow-fs-${access}=${path}`);
  }))];
  return [...flags("read", readable), ...flags("write", writable)];
}
