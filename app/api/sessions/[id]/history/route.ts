import { NextResponse } from "next/server";
import { authorizeCreationSessionId } from "@/lib/automation-creation-auth";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildSessionHistory, resolveSessionPath, SessionHistoryCursorError } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try{await authorizeCreationSessionId(id);}catch{return NextResponse.json({error:"请登录创建该自动化的 Haze 账号"},{status:403});}
  try {
    const rpc = getRpcSession(id);
    const live = rpc?.isAlive() ? rpc : undefined;
    const file = live ? null : await resolveSessionPath(id);
    if (!live && !file) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const manager = live?.inner.sessionManager ?? SessionManager.open(file!);
    const query = new URL(request.url).searchParams;
    const leaf = query.get("leafId") ?? manager.getLeafId();
    const history = buildSessionHistory(manager.getEntries() as never, leaf, {
      before: query.get("before") ?? undefined, deferThinking: true, deferToolResultImages: true,
    });
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: error instanceof SessionHistoryCursorError ? 409 : 500,
    });
  }
}
