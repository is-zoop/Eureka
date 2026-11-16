import { NextResponse } from "next/server";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ mode: SettingsManager.create(process.cwd()).getCacheWarmingMode() });
}
export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { mode } = await request.json();
    if (!["off", "streaming", "idle"].includes(mode)) return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    const settings = SettingsManager.create(process.cwd());
    settings.setCacheWarmingMode(mode);
    await settings.flush();
    for (const wrapper of globalThis.__piSessions?.values() ?? []) {
      wrapper.inner.setCacheWarmingMode?.(mode);
      await wrapper.inner.settingsManager.flush();
    }
    return NextResponse.json({ mode });
  } catch { return NextResponse.json({ error: "Unable to save" }, { status: 500 }); }
}
