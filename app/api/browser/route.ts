import { NextResponse } from "next/server";
import { browserAccess, browserError } from "@/lib/browser-access";
import { browserAction, browserReady, browserState, closeBrowser } from "@/lib/browser-runtime";
import type { BrowserAction } from "@/lib/browser-types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const access = await browserAccess(new URL(request.url).searchParams.get("sessionId"));
    return NextResponse.json({ state: browserState(access.owner, access.sessionId), ready: await browserReady() });
  } catch (error) { return NextResponse.json({ error: browserError(error) }, { status: 403 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const access = await browserAccess(typeof body.sessionId === "string" ? body.sessionId : null);
    if (body.action === "close") await closeBrowser(access.owner, access.sessionId);
    else await browserAction(access.owner, access.sessionId, body as BrowserAction);
    return NextResponse.json({ state: browserState(access.owner, access.sessionId) });
  } catch (error) { return NextResponse.json({ error: browserError(error) }, { status: 400 }); }
}
