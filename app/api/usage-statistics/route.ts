import { NextResponse } from "next/server";
import { loadUsageStatistics, usageRanges, type UsageRange } from "@/lib/usage-statistics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedRange = params.get("range") ?? "12m";
  if (!usageRanges.includes(requestedRange as UsageRange)) {
    return NextResponse.json({ error: "Invalid usage statistics range" }, { status: 400 });
  }
  try {
    const data = await loadUsageStatistics(requestedRange as UsageRange, params.get("refresh") === "1");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Usage statistics are temporarily unavailable" }, { status: 500 });
  }
}
