import { appFailure, appJson, automationAppAccess } from "@/features/automation/runtime/automation-app-server";
import { AutomationAppError } from "@/features/automation/runtime/automation-app-package";
import { syncOrganizationAutomations } from "@/features/automation/publication/haze-automation-install";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await automationAppAccess(request), { id } = await params, version = new URL(request.url).searchParams.get("version") ?? undefined;
    await syncOrganizationAutomations({source:auth.issuer.replace(/\/$/,""),subject:auth.subject,check:auth.assertIdentity});
    await auth.store.useLatest(); const detail = await auth.store.detail(id);
    if(detail.install.managedPlugin&&version&&version!==detail.install.activeVersion)throw new AutomationAppError("组织插件仅能使用当前安装版本",403);
    auth.assertIdentity(); return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, ...detail });
  } catch (e) { return appFailure(e); }
}
