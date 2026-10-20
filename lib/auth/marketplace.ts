import "server-only";

import { MARKETPLACE_PERMISSION } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { readAuthSession } from "@/lib/auth/session";
import { refreshRuntimeHazeSession } from "@/lib/auth/runtime-session";
import type { AuthSession } from "@/lib/auth/types";

type RefreshResult = { session: AuthSession; refreshed: boolean };

export function hasMarketplaceAccess(session: AuthSession | null) {
  return Boolean(session?.principal.permissions.includes(MARKETPLACE_PERMISSION));
}

export async function refreshMarketplaceSession(force = false): Promise<RefreshResult | null> {
  const current = await readAuthSession();
  if (!current) return null;
  const session = await refreshRuntimeHazeSession(current);
  if (!session?.accessToken) return null;
  if (force) {
    const provider = getIdentityProvider();
    if (!provider) return null;
    try {
      const principal = await provider.userInfo(session.accessToken);
      if (principal.subject !== current.principal.subject) return null;
      return { session: { ...session, principal }, refreshed: true };
    } catch { return null; }
  }
  return { session, refreshed: current.refreshToken !== session.refreshToken };
}
