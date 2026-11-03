import { appFailure, appJson, automationAppAccess } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { syncOrganizationAutomations } from "@/lib/haze-automation-install";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await automationAppAccess(request), { id } = await params, version = new URL(request.url).searchParams.get("version") ?? undefined;
    await syncOrganizationAutomations({source:auth.issuer.replace(/\/$/,""),subject:auth.subject,check:auth.assertIdentity});
    await auth.store.useLatest(); const detail = await auth.store.detail(id);
    if (version && version !== detail.manifest.version) throw new AutomationAppError("仅支持查看最新应用版本", 409);
    auth.assertIdentity(); return appJson({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, ...detail });
  } catch (e) { return appFailure(e); }
}
