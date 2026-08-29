import "server-only";

import { MARKETPLACE_PERMISSION } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { readAuthSession } from "@/lib/auth/session";
import type { AuthSession } from "@/lib/auth/types";

export function hasMarketplaceAccess(session: AuthSession | null) {
  return Boolean(session?.principal.permissions.includes(MARKETPLACE_PERMISSION));
}

export async function refreshMarketplaceSession(force = false): Promise<{ session: AuthSession; refreshed: boolean } | null> {
  const current = await readAuthSession();
  if (!current) return null;
  if (!force && current.expiresAt > Date.now() + 30_000) return { session: current, refreshed: false };
  const provider = getIdentityProvider();
  if (!provider) return null;
  try {
    const tokens = await provider.refresh(current.refreshToken);
    const principal = await provider.userInfo(tokens.accessToken);
    const session = { ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000, principal };
    return { session, refreshed: true };
  } catch {
    return null;
  }
}
