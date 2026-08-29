import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const errors: Record<string, string> = {
  access_denied: "当前账号没有技能市场访问权限。",
  invalid_client: "Eureka 的 Haze Client 或回调地址配置不正确。",
  invalid_grant: "授权已失效或已被使用，请重新登录。",
  invalid_token: "Haze 登录状态已失效，请重新登录。",
  callback_failed: "Haze 授权未完成，请重试。",
  not_configured: "登录服务尚未配置。",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const { returnTo, error } = await searchParams;
  const target = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-6"><Card className="w-full max-w-sm"><CardHeader><CardTitle>登录 Eureka</CardTitle><CardDescription>使用 Eureka 的 Agent、项目和会话功能前需要完成 Haze 登录。</CardDescription></CardHeader><CardContent>{error && <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--danger-hover)] px-3 py-2 text-sm text-[var(--danger)]">{errors[error] ?? "登录暂时不可用，请重试。"}</p>}</CardContent><CardFooter className="flex-col gap-3"><Link href={`/api/marketplace-auth/start?returnTo=${encodeURIComponent(target)}`} className="w-full"><Button className="w-full">使用 Haze 登录</Button></Link><p className="text-center text-xs text-[var(--text-muted)]">密码仅在 Haze 输入，Eureka 不会收集或保存你的密码。</p></CardFooter></Card></main>;
}
