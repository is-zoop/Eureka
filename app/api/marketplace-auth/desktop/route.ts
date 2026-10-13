import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { desktopLogins } from "@/lib/auth/desktop-login-store";
import { isSafeReturnTo, writeAuthSession } from "@/lib/auth/session";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  if (!config) return NextResponse.json({ error: "登录服务尚未配置。" }, { status: 503, headers });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  if (body.action === "start") {
    try {
      const pending = desktopLogins.start(isSafeReturnTo(body.returnTo) ? body.returnTo : "/");
      const browserUrl = new URL("/api/marketplace-auth/start", new URL(config.redirectUri).origin);
      browserUrl.searchParams.set("desktopRequest", pending.requestId);
      // The claim secret never enters the browser URL, OAuth state, or browser cookie.
      return NextResponse.json({ ...pending, browserUrl: browserUrl.href }, { headers });
    } catch {
      return NextResponse.json({ error: "待处理的登录过多，请稍后重试。" }, { status: 429, headers });
    }
  }
  if (typeof body.requestId !== "string" || typeof body.claimToken !== "string" || body.claimToken.length > 128) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  }
  if (body.action === "cancel") {
    desktopLogins.cancel(body.requestId, body.claimToken);
    return NextResponse.json({ status: "cancelled" }, { headers });
  }
  if (body.action !== "poll") return NextResponse.json({ error: "Invalid action" }, { status: 400, headers });
  const result = desktopLogins.claim(body.requestId, body.claimToken);
  if (!result) return NextResponse.json({ status: "expired" }, { status: 410, headers });
  if (result.status !== "complete") return NextResponse.json(result, { headers });
  const response = NextResponse.json({ status: "complete", returnTo: result.returnTo }, { headers });
  writeAuthSession(response.cookies, result.session);
  return response;
}
