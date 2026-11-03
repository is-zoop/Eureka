import { join } from "node:path";
import { appFailure, appJson, applicationAccess, readAppRequest } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { appWebService, appWebServices, lockAppBrowserGrants } from "@/lib/automation-app-browser-runtime";
import { appBrowserSpec, stopAppRun } from "@/lib/automation-app-runtime";
import { assertAppIdle } from "@/lib/automation-app-lease";
import { isAppId } from "@/lib/automation-app";
import type { AppWebGrant } from "@/lib/automation-app-browser";
import { hasJsonContentType } from "@/lib/request-security";
export const dynamic = "force-dynamic";
async function privateState(auth: {store:import("@/lib/automation-app-store").AutomationAppStore}, id: string, directory=auth.store.dataDirectory(id)) {
  const read = async <T>(name: string, fallback: T):Promise<T> => { try { return JSON.parse((await auth.store.privateBytes(join(directory, name), 512 * 1024)).toString("utf8")) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw e; } };
  const settings=await read<{schemaVersion:1;environments:Record<string,string>}>("browser-settings.json", { schemaVersion: 1, environments: {} }), grants=await read<{schemaVersion:1;grants:AppWebGrant[]}>("browser-grants.json", { schemaVersion: 1, grants: [] });
  if(!settings||settings.schemaVersion!==1||!settings.environments||typeof settings.environments!=="object"||Array.isArray(settings.environments)||!grants||grants.schemaVersion!==1||!Array.isArray(grants.grants)||grants.grants.some((g:unknown)=>!g||typeof g!=="object"||typeof (g as {digest?:unknown}).digest!=="string"))throw new AutomationAppError("网页环境或授权记录损坏，请检查本机应用数据。",409);
  return {settings,grants};
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, query = new URL(request.url).searchParams;
    const auth = await applicationAccess(request, query.has("ownerKey") || query.has("runtimeId") ? {ownerKey:query.get("ownerKey"),runtimeId:query.get("runtimeId")} : undefined), mode = query.get("mode");
    if (mode === "spec") return appJson({ ownerKey: auth.ownerKey, native: "task" in auth ? await (await import("@/lib/automation-authoring")).authorBrowserSpec(auth,id,query.get("runId")??"",query.get("siteId")??"") : await appBrowserSpec(auth, id, query.get("runId") ?? "", query.get("siteId") ?? "") });
    if (mode === "commands") {
      const bridgeId = query.get("bridgeId") ?? ""; if (!isAppId(bridgeId)) throw new AutomationAppError("面板连接 ID 无效");
      const requestedRun = query.get("runId");
      if (requestedRun && !isAppId(requestedRun)) throw new AutomationAppError("网页运行 ID 无效");
      const services = appWebServices(auth.ownerKey, id).filter(s => s.options.runtimeId === auth.runtimeId && s.options.taskId === ("taskId" in auth?auth.taskId:undefined) && (!requestedRun || s.options.runId === requestedRun));
      const service = services[0]; if (!service) return appJson({ runId: null, command: null });
      const command = service.presence(bridgeId,query.get("available")!=="false");
      return appJson({ runId: service.options.runId, owned: service.ownsBridge(bridgeId), native:service.nativeSession, hasOpened:service.hasOpened, command: command ? { id: command.id } : null, ...(query.has("commandId") ? { state: service.commandState(query.get("commandId")!) } : {}) });
    }
    if("task" in auth){const state=await(await import("@/lib/automation-authoring")).readAuthor(auth);if(state.explorer?.detail.install.id===id){const detail=state.explorer.detail;return appJson({ownerKey:auth.ownerKey,runtimeId:auth.runtimeId,declaration:detail.manifest.automation.browser,...await privateState({store:auth.host},id,detail.dataDirectory)});}}
    const detail = await auth.store.detail(id), state = await privateState(auth, id); auth.assertIdentity();
    return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, declaration: detail.manifest.automation.browser ?? null, ...state });
  } catch (e) { return appFailure(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("请求格式无效");
    const body = JSON.parse((await readAppRequest(request, 512 * 1024)).toString("utf8")), auth = await applicationAccess(request, body), { id } = await params;
    if (body.mode === "settings") {
      const result = await auth.store.admitRun(id, body.revision, async detail => {
        await assertAppIdle(detail.dataDirectory);
        if (!body.environments || typeof body.environments !== "object" || Array.isArray(body.environments)) throw new AutomationAppError("浏览环境无效");
        const sites = detail.manifest.automation.browser?.sites ?? [];
        const environments = Object.fromEntries(sites.map(site => { const env = body.environments[site.id] ?? "00000000000000000000000000000000"; if (env !== "temporary" && (typeof env !== "string" || !/^[a-f0-9]{32}$/.test(env))) throw new AutomationAppError("浏览环境无效"); return [site.id, env]; }));
        await auth.store.privateJson(join(detail.dataDirectory, "browser-settings.json"), { schemaVersion: 1, environments }); return { ok: true };
      }, false); return appJson(result);
    }
    if (body.mode === "revoke") {
      if(!isAppId(body.grantId))throw new AutomationAppError("授权 ID 无效");
      if("task" in auth){await(await import("@/lib/automation-authoring")).revokeAuthorGrant(auth,id,body.grantId);return appJson({ok:true});}
      for (const service of appWebServices(auth.ownerKey, id)) if (service.options.runtimeId === auth.runtimeId) await stopAppRun(auth, id, service.options.runId);
      return appJson(await auth.store.admitRun(id,body.revision,async detail=>{
      const directory = detail.dataDirectory;
      const release = await lockAppBrowserGrants(directory);
      try {
      auth.assertIdentity(); const state = await privateState(auth, id); if (!Array.isArray(state.grants.grants)) throw new AutomationAppError("授权记录无效");
      if(!state.grants.grants.some(g=>g.id===body.grantId))throw new AutomationAppError("授权记录不存在，请刷新后重试。",404);
      const grants = state.grants.grants.map((g: { id: string }) => g.id === body.grantId ? { ...g, revokedAt: new Date().toISOString() } : g);
      await auth.store.privateJson(join(directory, "browser-grants.json"), { schemaVersion: 1, grants }); return { ok: true };
      } finally { await release(); }
      },false));
    }
    const service = appWebService(auth.ownerKey, id, body.runId); if (service.options.runtimeId !== auth.runtimeId || service.options.taskId !== ("taskId" in auth?auth.taskId:undefined)) throw new AutomationAppError("登录代次或任务已变化", 409);
    if(body.mode==="detach"){await service.detach(body.bridgeId);return appJson({ok:true});}
    if(body.mode==="connection-failed"){if(!service.ownsBridge(body.bridgeId))throw new AutomationAppError("网页面板不属于本次连接",409);await service.connectionFailed(body.reason==="desktop-required"?"网页应用需要在 Eureka 桌面程序中执行；会话和草稿已保留。":"原网页视图已丢失，无法确认页面状态；本轮网页执行已中断，不会自动重新查询或提交。请在原会话核对后继续。");return appJson({ok:true});}
    if(body.mode==="defer")return appJson(await service.defer(body.commandId,body.lease,body.bridgeId));
    if (body.mode === "claim") return appJson(service.claim(body.commandId, body.bridgeId));
    if (body.mode === "arm") return appJson({ ticket: await service.arm(body.commandId, body.lease) });
    if (body.mode === "complete") { if(body.error!==undefined&&typeof body.error!=="string")throw new AutomationAppError("网页结果格式无效"); service.complete(body.commandId, body.lease, body.result, body.error); return appJson({ ok: true }); }
    if (body.mode === "approve") { await service.approve(body.approvalId, body.operationIds); return appJson({ ok: true }); }
    if (body.mode === "deny" || body.mode === "leave" && service.ownsBridge(body.bridgeId)) { if("task" in auth)await(await import("@/lib/automation-authoring")).stopAuthor(auth.task);else await stopAppRun(auth,id,body.runId); return appJson({ ok: true }); }
    throw new AutomationAppError("网页操作已过期或无效", 409);
  } catch (e) { return appFailure(e); }
}
