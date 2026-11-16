import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readPublicationAiSettings, writePublicationAiSettings } from "@/lib/automation-publication-ai-store";
import { parsePublicationAiSettings } from "@/lib/automation-publication-ai-settings";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await automationAppAccess(request), publicationAi = await readPublicationAiSettings();
    auth.assertIdentity();
    return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, publicationAi });
  } catch (error) { return appFailure(error); }
}
export async function PUT(request: Request) {
  try {
    if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) throw new AutomationAppError("请求来源或内容类型无效", 403);
    let body, settings;
    try { body = JSON.parse((await readAppRequest(request, 4096)).toString("utf8")); settings = parsePublicationAiSettings(body.publicationAi); }
    catch (error) { if (error instanceof AutomationAppError) throw error; throw new AutomationAppError("AI 资料生成设置无效", 400); }
    const auth = await automationAppAccess(request, body);
    const publicationAi = await writePublicationAiSettings(settings, undefined, auth.assertIdentity);
    auth.assertIdentity();
    return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, publicationAi });
  } catch (error) { return appFailure(error); }
}
