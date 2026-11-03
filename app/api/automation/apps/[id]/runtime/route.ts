import { appFailure, appJson, applicationAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { answerAppRun, appRunArtifact, appRunValue, getAppRun, grantAppFile, listAppRuns, readAppConfiguration, saveAppConfiguration, startAppRun, stopAppRun } from "@/lib/automation-app-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams, { id } = await params;
    const auth = await applicationAccess(request, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    const mode = query.get("mode"), runId = query.get("runId") ?? "";
    if (mode === "artifact") {
      const { bytes, artifact } = await appRunArtifact(auth, id, runId, query.get("artifactId") ?? "");
      const filename = encodeURIComponent(artifact.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": artifact.mediaType, "Content-Disposition": `attachment; filename="artifact"; filename*=UTF-8''${filename}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
    }
    let result;
    if (mode === "config") result = await readAppConfiguration(auth, id);
    else if (mode === "runs") result = await listAppRuns(auth, id);
    else if (mode === "run") {
      const record = await getAppRun(auth, id, runId), after = Number(query.get("after") ?? 0);
      result = { ...record, events: record.events.filter(event => event.seq > (Number.isSafeInteger(after) && after >= 0 ? after : 0)) };
    }
    else if (mode === "value") result = await appRunValue(auth, id, runId, query.get("ref") ?? "");
    else throw new AutomationAppError("读取操作无效");
    auth.assertIdentity(); return appJson(result);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return appJson({ error: "运行记录尚未建立或已经清理。" }, 404); return appFailure(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) throw new AutomationAppError("请求来源或内容类型无效", 403);
    const body = JSON.parse((await readAppRequest(request, 2 * 1024 * 1024)).toString("utf8"));
    const auth = await applicationAccess(request, body), { id } = await params;
    if (!body || !["save", "grant", "start", "stop", "answer"].includes(body.action)) throw new AutomationAppError("执行操作无效");
    if (["save", "grant", "start"].includes(body.action) && (!Number.isSafeInteger(body.revision) || body.revision < 1)) throw new AutomationAppError("应用版本引用无效");
    if (["save", "start"].includes(body.action) && (!Number.isSafeInteger(body.configRevision) || body.configRevision < 0 || !body.values || typeof body.values !== "object" || Array.isArray(body.values))) throw new AutomationAppError("配置版本或内容无效");
    let result;
    if (body.action === "save") result = await saveAppConfiguration(auth, id, body.revision, body.configRevision, body.values);
    else if (body.action === "grant") { if (typeof body.fieldId !== "string" || typeof body.path !== "string") throw new AutomationAppError("文件选择无效"); result = await grantAppFile(auth, id, body.revision, body.fieldId, body.path, body.access); }
    else if (body.action === "start") { if (typeof body.actionId !== "string") throw new AutomationAppError("请选择运行按钮"); result = await startAppRun(auth, id, body.revision, body.runId, body.values, body.configRevision, body.actionId); }
    else if (body.action === "stop") result = await stopAppRun(auth, id, body.runId);
    else result = await answerAppRun(auth, id, body.runId, body.questionId, body.responses);
    auth.assertIdentity(); return appJson(result);
  } catch (e) { return appFailure(e); }
}
