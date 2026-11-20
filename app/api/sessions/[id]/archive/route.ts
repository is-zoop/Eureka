import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { authorizeCreationSessionId } from "@/features/automation/authoring/automation-creation-auth";
import { peekRpcSession } from "@/server/agent/rpc-session-registry";
import { summarizeArchivedBranch, updateSessionArchive } from "@/features/sessions/server/session-archives";
import { resolveSessionPath } from "@/features/sessions/server/session-reader";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await authorizeCreationSessionId(id);
  } catch {
    return NextResponse.json({ code: "forbidden" }, { status: 403 });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("archived" in body) || typeof body.archived !== "boolean") {
    return NextResponse.json({ code: "invalid_archive_state" }, { status: 400 });
  }
  const { archived } = body;

  try {
    const path = await resolveSessionPath(id);
    if (!path) return NextResponse.json({ code: "not_found" }, { status: 404 });
    const archive = await updateSessionArchive(id, (current) => {
      if (!existsSync(path)) throw new ArchiveError("not_found", 404);
      if (!archived) return null;
      if (current) return current;
      const live = peekRpcSession(id);
      if (live?.isRunning()) throw new ArchiveError("session_running", 409);
      const manager = live?.inner.sessionManager ?? SessionManager.open(path);
      return { archivedAt: new Date().toISOString(), ...summarizeArchivedBranch(manager.getBranch()) };
    });
    return NextResponse.json({ archive });
  } catch (error) {
    if (error instanceof ArchiveError) return NextResponse.json({ code: error.message }, { status: error.status });
    return NextResponse.json({ code: "archive_failed" }, { status: 500 });
  }
}

class ArchiveError extends Error {
  constructor(code: string, readonly status: number) {
    super(code);
  }
}
