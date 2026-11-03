import { readAuthSession } from "@/lib/auth/session";
import { automationAccess } from "@/lib/automation-access";
import { parseAutomationTaskRef } from "@/lib/automation-mode";
import { assertAutomationTaskIdentity } from "@/lib/automation-mode-store";
import { authorizeCreationSessionId } from "@/lib/automation-creation-auth";
import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession, sendSessionToolCommand, readSessionCommands } from "@/lib/rpc-manager";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    try{await authorizeCreationSessionId(id);}catch{return NextResponse.json({error:"请登录创建该自动化的 Haze 账号",accepted:false,code:"prompt_rejected"},{status:403});}
    const body = await req.json() as { type: string; [key: string]: unknown };
    if (body.automationTask !== undefined) { const auth = await automationAccess(), ref = parseAutomationTaskRef(body.automationTask); if (ref.ownerKey !== auth.ownerKey) throw new Error("自动化任务不属于当前账号。"); auth.assertIdentity(); assertAutomationTaskIdentity(ref); }
    if (body.selectedPlugins && !await readAuthSession()) return NextResponse.json({ error: "请先登录 Haze", code: "prompt_rejected", accepted: false }, { status: 401 });
    commandType = typeof body.type === "string" ? body.type : undefined;
    const isPromptCommand = body.type === "prompt" || body.type === "execute_plan";

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      promptAccepted = isPromptCommand;
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(isPromptCommand
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }

    if (body.type === "get_tools" || body.type === "set_tools") {
      const result = await sendSessionToolCommand(id, filePath, body);
      return NextResponse.json({ success: true, data: result });
    }

    if (body.type === "get_commands") {
      return NextResponse.json({ success: true, data: await readSessionCommands(id, filePath) });
    }

    const { session } = await startRpcSession(id, filePath, undefined);
    const result = await session.send(body);
    promptAccepted = isPromptCommand;

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error(`[agent/${id}] Failed to command AgentSession:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...((commandType === "prompt" || commandType === "execute_plan") && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    try{await authorizeCreationSessionId(id);}catch{return NextResponse.json({error:"请登录创建该自动化的 Haze 账号"},{status:403});}
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
