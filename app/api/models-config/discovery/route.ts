import { NextResponse } from "next/server";
import { readModelDiscoveryState, refreshConfiguredProvider, setModelDiscoveryEnabled } from "@/lib/model-discovery-refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelDiscoveryState());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown; enabled?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName || typeof body.enabled !== "boolean") return NextResponse.json({ error: "providerName and enabled are required" }, { status: 400 });
    return NextResponse.json(setModelDiscoveryEnabled(providerName, body.enabled));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });
    return NextResponse.json(await refreshConfiguredProvider(providerName));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
