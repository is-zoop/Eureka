import { appFailure, automationAppAccess } from "@/lib/automation-app-server";
import { AutomationAppError } from "@/lib/automation-app-package";
import { isAppId } from "@/lib/automation-app";
export const dynamic = "force-dynamic";
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await route.params, query = new URL(request.url).searchParams;
    if (!isAppId(id)) throw new AutomationAppError("应用 ID 无效");
    const auth = await automationAppAccess(request, { ownerKey: query.get("ownerKey"), runtimeId: query.get("runtimeId") });
    const image = await auth.store.presentationIcon(id); auth.assertIdentity();
    return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return appFailure(error); }
}
