import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/features/automation/runtime/automation-app-server";
import { AutomationAppError } from "@/features/automation/runtime/automation-app-package";
import { isAppId } from "@/features/automation/shared/automation-app";
import { hazePublishingClient } from "@/server/extensions/haze-publishing";
import { hasJsonContentType } from "@/lib/request-security";
import { readAuthSession } from "@/lib/auth/session";
import { hazeAutomationAccess } from "@/features/automation/runtime/automation-access";
import { join } from "node:path";

export const dynamic = "force-dynamic";
async function access(request: Request, id: string, identity: { ownerKey?: unknown; runtimeId?: unknown }) {
  if (!isAppId(id)) throw new AutomationAppError("应用 ID 无效");
  const auth = await automationAppAccess(request, identity), app = await auth.store.find(id);
  if (!app) throw new AutomationAppError("应用未安装", 404);
  if (app.managedPlugin) throw new AutomationAppError("市场应用请先另存为我的应用再编辑", 403);
  const cache=join(auth.store.registryDirectory,"business-categories.json");
  let categories:{id:number;name:string}[]=[];
  try{const raw=JSON.parse((await auth.store.privateBytes(cache,256000)).toString("utf8"));if(Array.isArray(raw)&&raw.every(c=>Number.isSafeInteger(c.id)&&c.id>=1&&typeof c.name==="string"))categories=raw;}catch{/* Offline editing does not require a category cache. */}
  if(await readAuthSession())try{
    const cloud=await hazeAutomationAccess(),client=await hazePublishingClient(cloud.issuer,cloud.subject,cloud.assertIdentity),raw=await client.request<{id:number;name:string}[]>("/api/business-categories");
    if(Array.isArray(raw)&&raw.every(c=>Number.isSafeInteger(c.id)&&c.id>=1&&typeof c.name==="string")){categories=raw.map(c=>({id:c.id,name:c.name}));await auth.store.privateJson(cache,categories);}
  }catch{/* Cloud category refresh is optional for local metadata editing. */}
  const selected=app.presentation?.categoryId;if(selected!==null&&selected!==undefined&&!categories.some(c=>c.id===selected))categories.push({id:selected,name:`#${selected}`});
  return { ...auth, categories };
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
