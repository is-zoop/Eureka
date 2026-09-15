import { NextResponse } from "next/server";
import { getMcpRuntime } from "@/lib/mcp-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  return NextResponse.json({ status: getMcpRuntime(sessionId) });
}
