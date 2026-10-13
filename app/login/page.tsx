import { NotificationNotice } from "@/components/Notifications";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { HazeLoginButton } from "@/components/HazeLoginButton";
import { isSafeReturnTo } from "@/lib/auth/session";

const errors: Record<string, string> = {
  access_denied: "当前账号没有技能市场访问权限。",
  invalid_client: "Eureka 的 Haze Client 或回调地址配置不正确。",
  invalid_grant: "授权已失效或已被使用，请重新登录。",
  invalid_token: "Haze 登录状态已失效，请重新登录。",
  callback_failed: "Haze 授权未完成，请重试。",
  not_configured: "登录服务尚未配置。",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string; desktop?: string }> }) {
  const { returnTo, error, desktop } = await searchParams;
  const target = isSafeReturnTo(returnTo) ? returnTo : "/";
  if (desktop === "success" || desktop === "failed") {
    return <main className="eureka-login-page"><Card className="relative w-full max-w-sm"><CardHeader><CardTitle>{desktop === "success" ? "Haze 授权已完成" : "Haze 授权未完成"}</CardTitle><CardDescription>{desktop === "success" ? "请返回 Eureka 桌面端，应用会自动继续。你可以关闭此浏览器页面。" : "请返回 Eureka 桌面端重新发起登录。你可以关闭此浏览器页面。"}</CardDescription></CardHeader></Card></main>;
  }
  return <main className="eureka-login-page"><Card className="relative w-full max-w-sm"><CardHeader><CardTitle>登录 Eureka</CardTitle><CardDescription>登录以使用Haze企业扩展</CardDescription></CardHeader><NotificationNotice message={error ? errors[error] ?? "登录暂时不可用，请重试。" : null} type="error" /><CardFooter className="flex-col gap-3 pt-2"><HazeLoginButton returnTo={target} /></CardFooter></Card></main>;
}
