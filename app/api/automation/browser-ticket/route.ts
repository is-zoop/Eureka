import { consumeAppBrowserTicket, checkAppBrowserTicket } from "@/features/automation/runtime/automation-app-browser-runtime";
import { readAppRequest } from "@/features/automation/runtime/automation-app-server";
import { isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const ticket = request.headers.get("x-eureka-browser-ticket") ?? "";
    if (!isApiRequestAllowed(request) || !/^[a-f0-9]{64}$/.test(ticket)) return new Response(null, { status: 403 });
    const payload=(await readAppRequest(request, 100000)).toString("utf8");
    if(request.headers.get("x-eureka-browser-ticket-check")==="1") await checkAppBrowserTicket(ticket,payload);
    else await consumeAppBrowserTicket(ticket,payload);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 409 }); }
}
