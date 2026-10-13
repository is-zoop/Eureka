import { NextResponse } from "next/server";
import { hasMarketplaceAccess, refreshMarketplaceSession } from "@/lib/auth/marketplace";
import { clearAuthSession, readGuestSession } from "@/lib/auth/session";
import { GUEST_AVATAR_URL, GUEST_NAME } from "@/lib/auth/guest";

function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 512_000) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value) ? value : null;
}

export async function GET() {
  if (await readGuestSession()) {
    return NextResponse.json({
      authenticated: false,
      guest: true,
      marketplace: false,
      user: { name: GUEST_NAME, email: null, avatarUrl: GUEST_AVATAR_URL, permissions: [] },
    }, { headers: { "Cache-Control": "no-store" } });
  }
  // The encrypted cookie deliberately excludes the access token and avatar.
  // Refresh here so the client receives a current, display-safe profile only.
  const result = await refreshMarketplaceSession(true);
  if (!result) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    clearAuthSession(response.cookies);
    return response;
  }
  const { session } = result;
  const response = NextResponse.json({
    authenticated: true,
    guest: false,
    marketplace: hasMarketplaceAccess(session),
    user: {
      name: session.principal.name,
      email: session.principal.email ?? null,
      avatarUrl: safeAvatarUrl(session.principal.avatarUrl),
      permissions: session.principal.permissions,
    },
  });
  if (result.refreshed) {
    const { writeAuthSession } = await import("@/lib/auth/session");
    writeAuthSession(response.cookies, session);
  }
  return response;
}
