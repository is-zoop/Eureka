import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { isAppId } from "@/lib/automation-app";
import { hazePublishingClient } from "@/lib/haze-publishing";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";
async function access(request: Request, id: string, identity: { ownerKey?: unknown; runtimeId?: unknown }) {
  if (!isAppId(id)) throw new AutomationAppError("应用 ID 无效");
  const auth = await automationAppAccess(request, identity), app = await auth.store.find(id);
  if (!app) throw new AutomationAppError("应用未安装", 404);
  if (app.managedPlugin) throw new AutomationAppError("市场应用请先另存为我的应用再编辑", 403);
  const client = await hazePublishingClient(auth.issuer, auth.subject, auth.assertIdentity);
  const raw = await client.request<{ id: number; name: string }[]>("/api/business-categories");
  if (!Array.isArray(raw) || raw.some(c => !Number.isSafeInteger(c.id) || c.id < 1 || typeof c.name !== "string")) throw new AutomationAppError("Haze 业务分类格式无效", 502);
  return { ...auth, categories: raw.map(c => ({ id: c.id, name: c.name })) };
}
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await route.params, query = new URL(request.url).searchParams;
    const auth = await access(request, id, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    const values = await auth.store.editValues(id); auth.assertIdentity();
    return appJson({ ...values, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, categories: auth.categories });
  } catch (error) { return appFailure(error); }
}
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("请求格式无效");
    let body;
    try { body = JSON.parse((await readAppRequest(request, 4 * 1024 * 1024)).toString("utf8")); }
    catch (error) { if (error instanceof AutomationAppError) throw error; throw new AutomationAppError("请求格式无效"); }
    if (!body || !Number.isSafeInteger(body.revision)) throw new AutomationAppError("应用修订号无效");
    const { id } = await route.params, auth = await access(request, id, body);
    await auth.store.edit(id, body.revision, body.values, auth.categories.map(c => c.id));
    const detail = await auth.store.detail(id); auth.assertIdentity();
    return appJson({ ...detail, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId });
  } catch (error) { return appFailure(error); }
}
