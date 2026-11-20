import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { readCommandEnvironment, writeCommandEnvironment } from "@/server/agent/command-environment-store";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try { return NextResponse.json({ environment: await readCommandEnvironment(), powershellAvailable: process.platform === "win32" }); }
  catch { return NextResponse.json({ error: "Unable to read command environment" }, { status: 500 }); }
}
export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try { const body = await request.json(); return NextResponse.json({ environment: await writeCommandEnvironment(body.environment), powershellAvailable: process.platform === "win32" }); }
  catch { return NextResponse.json({ error: "Invalid command environment" }, { status: 400 }); }
}
