"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type State = "loading" | "ready" | "denied";

export default function MarketplacePage() {
  const [state, setState] = useState<State>("loading");
  useEffect(() => { fetch("/api/marketplace-auth/session", { cache: "no-store" }).then(async response => ({ response, body: await response.json() })).then(({ response, body }) => { if (response.status === 401) { window.location.replace("/login?returnTo=/marketplace"); return; } setState(body.marketplace ? "ready" : "denied"); }).catch(() => window.location.replace("/login?returnTo=/marketplace")); }, []);
  if (state === "loading") return <main className="grid min-h-screen place-items-center bg-[var(--bg)] text-sm text-[var(--text-muted)]">正在确认授权状态…</main>;
  if (state === "denied") return <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-6"><Card className="w-full max-w-sm"><CardHeader><CardTitle>没有访问权限</CardTitle><CardDescription>你的 Haze 账号尚未获授 `page.marketplace` 权限。</CardDescription></CardHeader></Card></main>;
  return <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-6"><Card className="w-full max-w-sm"><CardHeader><CardTitle>企业技能市场</CardTitle><CardDescription>身份接入已完成。后续市场能力可在此页面逐步接入。</CardDescription></CardHeader><CardContent className="text-sm text-[var(--text-muted)]">Eureka 的 Agent、项目与会话现在均需要 Haze 登录。</CardContent><CardFooter><Button variant="outline" onClick={() => fetch("/api/marketplace-auth/logout", { method: "POST" }).then(() => window.location.replace("/login"))}>退出 Eureka</Button></CardFooter></Card></main>;
}
