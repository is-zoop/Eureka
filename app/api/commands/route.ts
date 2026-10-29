import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { loadCommandResources } from "@/lib/command-catalog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sessionId = params.get("sessionId");
  try {
    let cwd = params.get("cwd");
    if (sessionId) {
      const live = getRpcSession(sessionId);
      if (live?.isAlive()) {
        // Existing global wrappers can outlive this module during hot reload.
        const snapshot = typeof live.getCommandSnapshot === "function" ? live.getCommandSnapshot() : await live.send({ type: "get_commands" });
        return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
      }
      const file = await resolveSessionPath(sessionId);
      if (!file) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      cwd = readSessionHeader(file)?.cwd ?? null;
    }
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const { commands } = await loadCommandResources(cwd, params.get("force") === "1");
    return NextResponse.json({ commands }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
