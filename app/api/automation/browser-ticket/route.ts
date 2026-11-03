import { consumeAppBrowserTicket } from "@/lib/automation-app-browser-runtime";
import { readAppRequest } from "@/lib/automation-app-server";
import { isApiRequestAllowed } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const ticket = request.headers.get("x-eureka-browser-ticket") ?? "";
    if (!isApiRequestAllowed(request) || !/^[a-f0-9]{64}$/.test(ticket)) return new Response(null, { status: 403 });
    await consumeAppBrowserTicket(ticket, (await readAppRequest(request, 100000)).toString("utf8"));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 409 }); }
}
