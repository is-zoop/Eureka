import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/features/sessions/server/session-reader";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/server/agent/rpc-session-registry";
import { readSessionArchives } from "@/features/sessions/server/session-archives";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const archives = readSessionArchives();
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions).map((session) => ({
      ...session,
      archivedAt: archives.get(session.id)?.archivedAt,
    }));
    return NextResponse.json(
      { sessions, runningSessionIds: getRunningRpcSessionIds() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
