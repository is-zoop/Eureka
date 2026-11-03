import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { isAppId } from "@/lib/automation-app";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { syncOrganizationAutomations } from "@/lib/haze-automation-install";
import { getAllowedFileRoots,isExistingFilePathAllowed } from "@/lib/file-access";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await automationAppAccess(request),cwd=new URL(request.url).searchParams.get("cwd")??undefined;
    if(cwd&&!isExistingFilePathAllowed(cwd,await getAllowedFileRoots()))throw new AutomationAppError("当前项目不可访问",403);
    await syncOrganizationAutomations({source:auth.issuer.replace(/\/$/,""),subject:auth.subject,check:auth.assertIdentity},cwd);
    await auth.store.useLatest(); const result = await auth.store.list(); auth.assertIdentity();
    return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, stage: "A03", ...result });
  } catch (e) { return appFailure(e); }
}
export async function POST(request: Request) {
  try {
    if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) throw new AutomationAppError("请求来源或内容类型无效", 403);
    let body; try { body = JSON.parse((await readAppRequest(request, 8192)).toString("utf8")); } catch (e) { if (e instanceof AutomationAppError) throw e; throw new AutomationAppError("请求格式无效"); }
    if (!body || !isAppId(body.id) || !["save-as", "uninstall", "clear-data"].includes(body.action)) throw new AutomationAppError("应用操作无效");
    const auth = await automationAppAccess(request, body);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new AutomationAppError("登记版本无效");
    let result;
    if (body.action === "save-as") {
      result = await auth.store.saveAs(body.id, body.revision, body.newId, body.displayName);
    } else if (body.action === "clear-data") {
      if (body.confirmAppId !== body.id) throw new AutomationAppError("请确认要清理的应用数据");
      result = await auth.store.clearData(body.id, body.revision);
    } else if (body.action === "uninstall") {
      if (body.deleteData !== undefined && typeof body.deleteData !== "boolean") throw new AutomationAppError("删除数据选项无效");
      if (body.deleteData === true && body.confirmAppId !== body.id) throw new AutomationAppError("请确认要删除的应用数据");
      result = await auth.store.uninstall(body.id, body.revision, undefined, body.deleteData === true);
    }
    auth.assertIdentity(); return appJson(result);
  } catch (e) { return appFailure(e); }
}
