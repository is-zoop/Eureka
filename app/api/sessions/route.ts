import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { creationOwnerFromCwd } from "@/lib/automation-creation-auth";
import { automationAccess } from "@/lib/automation-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const merged = mergeSessionLists(persistedSessions, runtimeSessions);let owner:string|null=null;
    if(merged.some(s=>creationOwnerFromCwd(s.cwd)))try{owner=(await automationAccess()).ownerKey;}catch{/* Guest and other identities do not browse private creation histories. */}
    const hidden=new Set(merged.filter(s=>{const key=creationOwnerFromCwd(s.cwd);return key&&key!==owner;}).map(s=>s.id));
    const sessions=merged.filter(s=>!hidden.has(s.id));
    return NextResponse.json(
      { sessions, runningSessionIds: getRunningRpcSessionIds().filter(id=>!hidden.has(id)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
