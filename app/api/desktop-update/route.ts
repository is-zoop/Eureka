import { NextResponse } from "next/server";
import { authorizeDesktopUpdate, setDesktopUpdateDrain } from "@/lib/desktop-update-gate";

export const dynamic = "force-dynamic";
// Native-only: the per-launch secret is passed directly to the bundled sidecar.
export async function POST(request: Request) {
  if (!authorizeDesktopUpdate(request.headers.get("x-eureka-update-token"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { action } = await request.json();
    if (action !== "prepare" && action !== "cancel") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    setDesktopUpdateDrain(action === "prepare");
    return NextResponse.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update preparation failed" }, { status: 409 });
  }
}
