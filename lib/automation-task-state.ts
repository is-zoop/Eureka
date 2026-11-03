export type AutomationTaskPhase = "idle" | "opening" | "loading" | "manual" | "stopping" | "stopped" | "error";
export interface AutomationTaskState { phase: AutomationTaskPhase; message?: string }
export interface AutomationBrowserControls {
  stop: () => Promise<void>; restart: () => void;
  observe: (screenshot: boolean) => Promise<import("./automation-observation").PageObservation>;
  validateObservation: (id: string) => Promise<void>;
  claimApplication?: () => Promise<void>;
  applicationRequest?: (payload: string, ticket: string) => Promise<unknown>;
  pauseAutomation: () => Promise<void>;
}

// Only fixed host messages are displayed. Raw errors can include page URLs.
const hostErrors = new Set([
  "请输入完整的 HTTP/HTTPS 网页地址", "仅支持不含用户名密码的 HTTP/HTTPS 网页地址",
  "浏览器显示区域无效", "网站视图已关闭，请重新打开", "无法创建临时网站环境",
  "原生网站视图创建失败，请检查 WebView2 运行时", "无法调整网站显示区域",
]);
export function automationBrowserError(error: unknown, fallback: string) {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const accountErrors: Record<string, string> = {
    accountBusy: "此网站账号正在使用或清理中，请关闭其他使用窗口，稍后重试。",
    accountMissing: "网站账号已删除或登录环境已重置，请重新选择浏览环境并保存配置。",
    accountSiteMismatch: "网站与浏览环境不匹配，请选择该网站的账号并保存配置。",
    accountStorageFailed: "无法读取网站账号资料，请在账号管理中刷新后重试。",
    accountInvalid: "网站账号引用无效，请重新选择账号并保存。",
    accountPasswordUnavailable: "浏览器密码保存设置未能应用，请重试；仍失败时检查 WebView2 运行时版本。",
  };
  if (accountErrors[message]) return accountErrors[message];
  if (hostErrors.has(message)) return message;
  if (message.includes("desktop_automation_browser") && /not found|unknown command/i.test(message)) return "桌面程序版本较旧，请使用已编译的原生浏览器测试版。";
  return fallback;
}
