import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const startupId = process.env.EUREKA_DESKTOP_STARTUP_ID;
  const headers = { "Cache-Control": "no-store" };
  if (!/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(request.headers.get("host") ?? "") || !isApiRequestAllowed(request)
      || !startupId || !/^[a-f0-9]{32}$/.test(startupId)) {
    return new Response(null, { status: 404, headers });
  }
  // This ID grants no permissions. The host compares it without sending it to
  // the process listening on the port.
  return new Response(null, { status: 204, headers: { ...headers, "X-Eureka-Startup-Id": startupId } });
}
