import { applicationAccess, appFailure, appJson, readAppRequest } from "@/lib/automation-app-server";
import { readBusinessAi, saveBusinessAi } from "@/lib/automation-business-ai-store";
import { hasJsonContentType } from "@/lib/request-security";
import { AutomationAppError } from "@/lib/automation-app-package";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const auth = await applicationAccess(request), { id } = await params; const result = await readBusinessAi(auth.store, id); auth.assertIdentity(); return appJson(result); } catch (error) { return appFailure(error); }
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("请求格式无效", 400);
    const body = JSON.parse((await readAppRequest(request, 8192)).toString("utf8")), auth = await applicationAccess(request, body), { id } = await params;
    return appJson(await saveBusinessAi(auth.store, id, body.revision, body.configRevision, body.settings));
  } catch (error) { return appFailure(error); }
}
