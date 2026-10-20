import { NextResponse } from "next/server";
import { writeGuestSession } from "@/lib/auth/session";
import { guestReturnTo } from "@/lib/auth/guest";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const response = NextResponse.json({ guest: true, returnTo: guestReturnTo(body.returnTo) }, { headers: { "Cache-Control": "no-store" } });
  await writeGuestSession(response.cookies);
  return response;
}
