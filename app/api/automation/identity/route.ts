import { NextResponse } from "next/server";
import { automationAccess, DraftIdentityError } from "@/lib/automation-access";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const identity = await automationAccess(); identity.assertIdentity(); return NextResponse.json({ ownerKey: identity.ownerKey }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof DraftIdentityError ? "authenticationRequired" : "identityUnavailable" }, { status: error instanceof DraftIdentityError ? 401 : 500, headers: { "Cache-Control": "no-store" } }); }
}
