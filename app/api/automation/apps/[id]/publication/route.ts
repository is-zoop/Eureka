import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/features/automation/runtime/automation-app-server";
import { AutomationAppError, parseAutomationAppArchive } from "@/features/automation/runtime/automation-app-package";
import { isAppId } from "@/features/automation/shared/automation-app";
import { PublicationStore } from "@/features/automation/publication/automation-publication-store";
import { AutomationPublication } from "@/features/automation/publication/automation-publication-service";
import { hazePublishingClient, readPublishContext } from "@/server/extensions/haze-publishing";
import { hasJsonContentType } from "@/lib/request-security";
import { hazeAutomationAccess } from "@/features/automation/runtime/automation-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 1860;

async function access(request: Request, id: string, identity: { ownerKey?: unknown; runtimeId?: unknown; cloudSessionId?: unknown }) {
  if (!isAppId(id)) throw new AutomationAppError("应用 ID 无效");
  const auth = await automationAppAccess(request, identity);
  const cloud = await hazeAutomationAccess();
  if(request.method!=="GET"&&identity.cloudSessionId!==cloud.runtimeId)throw new AutomationAppError("云端登录已变化，请重新打开发布窗口",409);
  const check = () => { auth.assertIdentity(); cloud.assertIdentity(); };
  const detail = await auth.store.detail(id);
  if (detail.install.managedPlugin) throw new AutomationAppError("市场应用请先另存为我的应用，再发布", 403);
  const exported = await auth.store.export(id), pkg = parseAutomationAppArchive(exported.bytes);
  const client = await hazePublishingClient(cloud.issuer, cloud.subject, check), context = await readPublishContext(client);
  const store = new PublicationStore(auth.store.base, cloud.ownerKey, id, cloud.issuer, cloud.subject, check);
  const metadata = await auth.store.editValues(id);
  const service = new AutomationPublication({ store, pkg, archive: exported.bytes, client, context, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId,
    metadata: { revision: metadata.metadataRevision ?? pkg.digest, saved: Boolean(detail.install.presentation), name: metadata.displayName, description: metadata.description, categoryId: metadata.categoryId, tags: metadata.tags, icon: metadata.icon },
    check, assertCurrent: async () => {
      check(); const current = await auth.store.detail(id);
      if (current.install.revision !== detail.install.revision || current.manifest.version !== pkg.manifest.version || current.install.managedPlugin) throw new AutomationAppError("本地应用已变化，请重新打开发布窗口", 409);
    },
  });
  return { store, service, pkg, cloudSessionId:cloud.runtimeId };
}

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await route.params, query = new URL(request.url).searchParams;
    const { store, service, cloudSessionId } = await access(request, id, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    return appJson({...await store.locked(() => service.load({ refreshMetadata: query.get("metadata") === "latest" }), { wait: true }),cloudSessionId});
  } catch (error) { return appFailure(error); }
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("发布请求需要 JSON 格式");
    let body;
    try { body = JSON.parse((await readAppRequest(request, 6 * 1024 * 1024)).toString("utf8")); }
    catch (error) { if (error instanceof AutomationAppError) throw error; throw new AutomationAppError("发布请求格式无效"); }
    if (!body || !["draft", "generate", "save", "submit-review", "publish", "retry"].includes(body.action)) throw new AutomationAppError("发布操作无效");
    const { id } = await route.params, { store, service, pkg, cloudSessionId } = await access(request, id, body);
    return appJson({...await store.locked(async () => {
      await service.load();
      if (body.action !== "retry" && body.digest !== pkg.digest) throw new AutomationAppError("本地应用包已变化，请刷新发布窗口", 409);
      if (body.action === "draft") return service.saveLocal(body.draft);
      if (body.action === "generate") { await service.saveLocal(body.draft); return service.generate(body.locale === "en" ? "en" : "zh-CN", request.signal); }
      if (body.action === "save") return service.saveRemote(body.draft, body.allowLiveMetadata === true);
      if (body.action === "retry") return service.retry();
      return service.transition(body.action);
    }),cloudSessionId});
  } catch (error) { return appFailure(error); }
}
