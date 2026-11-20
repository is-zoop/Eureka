import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readSubscriptionQuotas, redeemSubscriptionReset } from "@/server/models/subscription-quota-runtime";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({}, { status: 403, headers });
  try {
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    return Response.json(await readSubscriptionQuotas(request.signal, preview), { headers });
  } catch {
    return Response.json({}, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return Response.json({}, { status: 403, headers });
  const body = await request.json().catch(() => null);
  if (!body || !["openai", "openai-codex"].includes(body.provider) || typeof body.credit !== "string" || !body.credit || body.credit.length > 256 || typeof body.quote !== "string" || body.quote.length > 128) {
    return Response.json({}, { status: 400, headers });
  }
  return Response.json({ result: await redeemSubscriptionReset(body.provider, body.credit, body.quote, request.signal) }, { headers });
}
