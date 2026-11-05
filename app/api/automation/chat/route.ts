import { automationAppAccess, appFailure, appJson, readAppRequest } from "@/lib/automation-app-server";
import { automationChatAccess, chatInvocationSnapshot, listChatInvocations, prepareChatRestart, selectChatFile } from "@/lib/automation-chat";
import { hasJsonContentType } from "@/lib/request-security";
import { authorizeCreationSessionId } from "@/lib/automation-creation-auth";
import { resolveSessionPath } from "@/lib/session-reader";
import { isAppId } from "@/lib/automation-app";
import { AutomationAppError } from "@/lib/automation-app-package";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("请求格式无效。");
    const body = JSON.parse((await readAppRequest(request, 16 * 1024)).toString("utf8"));
    await automationAppAccess(request, body);
    if (!["restart", "select-file"].includes(body.action) || !isAppId(body.sessionId) || !isAppId(body.invocationId)) throw new AutomationAppError("调用引用无效。");
    await authorizeCreationSessionId(body.sessionId);
    if (!await resolveSessionPath(body.sessionId)) throw new AutomationAppError("会话不存在。", 404);
    const auth = automationChatAccess();
    if (auth.ownerKey !== body.ownerKey || auth.runtimeId !== body.runtimeId) throw new AutomationAppError("登录身份已变化。", 409);
    if (body.action === "select-file") {
      if (typeof body.groupId !== "string" || typeof body.path !== "string") throw new AutomationAppError("文件选择引用无效。");
      await selectChatFile(auth, body.sessionId, body.invocationId, body.groupId, body.path);
      return appJson({ ok: true });
    }
    const invocation = await prepareChatRestart(auth, body.sessionId, body.invocationId, body.previousRunId, body.nextRunId);
    return appJson({ runId: invocation.runId });
  } catch (error) { return appFailure(error); }
}
export async function GET(request: Request) {
  try {
    await automationAppAccess(request);
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!isAppId(sessionId)) throw new AutomationAppError("会话引用无效。");
    await authorizeCreationSessionId(sessionId);
    if (!await resolveSessionPath(sessionId)) throw new AutomationAppError("会话不存在。", 404);
    const auth = automationChatAccess(), invocations = await listChatInvocations(auth, sessionId);
    if (new URL(request.url).searchParams.get("mode") === "list") {
      const snapshots = await Promise.all(invocations.map(async invocation => {
        try {
          const snapshot = await chatInvocationSnapshot(auth, invocation);
          return { ...snapshot, run: snapshot.run ? { ...snapshot.run, events: [] } : null };
        } catch (error) {
          auth.assertIdentity();
          // An uninstalled app must not hide every other card in the session.
          return { invocation, detail: null, run: null, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId,
            error: error instanceof AutomationAppError ? error.message : "该次应用运行暂时无法读取。" };
        }
      }));
      auth.assertIdentity();
      return appJson({ invocations: snapshots });
    }
    const latest = invocations[0];
    if (!latest) return appJson(null);
    const snapshot = await chatInvocationSnapshot(auth, latest);
    // The shared workbench polls incremental events itself; do not duplicate
    // the entire log in the conversation's discovery poll.
    return appJson({ ...snapshot, run: snapshot.run ? { ...snapshot.run, events: [] } : null });
  } catch (error) { return appFailure(error); }
}
