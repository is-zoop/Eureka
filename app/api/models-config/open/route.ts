import { NextResponse } from "next/server";
import { openModelsConfigFile } from "@/lib/models-config-open";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    await openModelsConfigFile();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not open the models configuration in a text editor" }, { status: 500 });
  }
}
