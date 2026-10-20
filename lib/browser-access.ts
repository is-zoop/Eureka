import { getRpcSession } from "./rpc-manager";
import { readAuthSession } from "./auth/session";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { getAuthConfig } from "./auth/config";
import { browserOwner, hasBrowser } from "./browser-runtime";
import { resolveSessionPath } from "./session-reader";
export async function browserAccess(sessionId: string | null) {
  const auth = await readAuthSession();
  const runtime = readRuntimeHazeSession();
  if (!auth || !runtime || auth.principal.subject !== runtime.principal.subject) throw new Error("请登录当前 Haze 账号后使用浏览器");
  const owner = browserOwner(getAuthConfig()!.issuer, auth.principal.subject);
  if (!sessionId || (!hasBrowser(owner, sessionId) && !getRpcSession(sessionId)?.isAlive() && !await resolveSessionPath(sessionId))) throw new Error("会话不存在");
  return { owner, sessionId };
}
export function browserError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // Playwright errors can contain visited URLs and launch grants. Never return them.
  if (/^(未安装 Chromium|请登录|登录身份|会话不存在|网页地址无效|请输入完整|仅支持不含|浏览器标签页已关闭|浏览器操作参数无效|鼠标操作无效|按键操作无效|输入文本过长|浏览器操作不支持)/.test(message)) return message;
  return "网页操作失败，请检查地址和服务状态后重试。";
}
