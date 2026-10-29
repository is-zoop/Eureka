import { readClarificationState } from "@/lib/clarification";
import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext, buildSessionHistory, SessionHistoryCursorError } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const entries = sm.getEntries();
    const selectedLeaf = leafId ?? sm.getLeafId();
    const context = buildSessionContext(entries as never, selectedLeaf, {
      deferThinking,
      deferToolResultImages,
    });

    return NextResponse.json({ context,
      ...(url.searchParams.get("includeHistory") === "1" ? { history: buildSessionHistory(entries as never, selectedLeaf, { deferThinking, deferToolResultImages }) } : {}),
      clarification: readClarificationState(sm.getBranch(selectedLeaf ?? undefined) as never) });
  } catch (error) {
    if (error instanceof SessionHistoryCursorError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
