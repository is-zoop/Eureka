import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { automationAccess } from "@/lib/automation-access";
import { readRuntimeHazeSession } from "@/lib/auth/runtime-session";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { parseAutomationTaskRef, readAutomationMode } from "@/lib/automation-mode";
import { readAutomationTask, changeAutomationTask } from "@/lib/automation-mode-store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) => NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
async function context(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error();
  const live = getRpcSession(id), file = live ? null : await resolveSessionPath(id), manager = live?.inner.sessionManager ?? (file ? SessionManager.open(file) : null);
  if (!manager) throw new Error(); return { live, manager };
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({}, 403);
  try {
    const auth = await automationAccess(), runtimeId = readRuntimeHazeSession()?.runtimeId; if (!runtimeId) throw new Error();
    const id = new URL(request.url).searchParams.get("sessionId"); let mode = null, closedTaskId: string | null = null;
    if (id) { const { manager } = await context(id), record = readAutomationMode(manager.getBranch()); if (record && record.task.ownerKey === auth.ownerKey && record.task.runtimeId === runtimeId) { const saved = await readAutomationTask(record.task); if (saved?.sessionId === id) { if (saved.status === "exited") closedTaskId = saved.task.id; else mode = { task: saved.task, sessionId: id, status: saved.status, updatedAt: saved.updatedAt }; } } }
    auth.assertIdentity(); return json({ ownerKey: auth.ownerKey, runtimeId, mode, closedTaskId, stage: "A05", creationPhase: "authoring" });
  } catch { return json({ error: "无法读取创建任务，请确认 Haze 登录后重试。" }, 409); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return json({}, 403);
  try {
    const reader = request.body?.getReader(); if (!reader) throw new Error(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return json({}, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!["pause", "exit"].includes(body.mode)) throw new Error();
    const auth = await automationAccess(), ref = parseAutomationTaskRef(body.task); if (ref.ownerKey !== auth.ownerKey) throw new Error();
    const { live, manager } = await context(body.sessionId); auth.assertIdentity();
    if (live?.isAlive()) await live.send({ type: body.mode === "exit" ? "exit_automation_task" : "pause_automation_task", automationTask: ref });
    else await changeAutomationTask(manager, ref, body.mode === "exit" ? "exited" : "paused");
    return json({ ok: true });
  } catch { return json({ error: "创建任务暂停或退出未确认，请重试。" }, 409); }
}
