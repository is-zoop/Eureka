import { NextResponse } from "next/server";
import { authorizeCreationSessionId, creationOwnerFromCwd } from "@/features/automation/authoring/automation-creation-auth";
import { readSessionArchives } from "@/features/sessions/server/session-archives";
import { listAllSessions } from "@/features/sessions/server/session-reader";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const archives = readSessionArchives();
    const archived = await Promise.all(sessions.flatMap((session) => {
      const archive = archives.get(session.id);
      if (!archive) return [];
      return [creationOwnerFromCwd(session.cwd)
        ? authorizeCreationSessionId(session.id).then(() => ({ ...session, archive }), () => null)
        : Promise.resolve({ ...session, archive })];
    }));
    return NextResponse.json({ sessions: archived.filter((session) => session !== null) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ code: "archive_load_failed" }, { status: 500 });
  }
}
