import "server-only";

import { MARKETPLACE_PERMISSION } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { readAuthSession } from "@/lib/auth/session";
import { getRememberedHazeAccessSession, rememberHazeAccessSession } from "@/lib/auth/access-token-cache";
import type { AuthSession } from "@/lib/auth/types";

type RefreshResult = { session: AuthSession; refreshed: boolean };

type RefreshCache = Map<string, { expiresAt: number; result: Promise<RefreshResult | null> }>;

declare global {
  // Route handlers may be evaluated in separate module instances during Next
  // development. Keep refresh-token rotation coordination process-wide.
  var __eurekaMarketplaceRefreshCache: RefreshCache | undefined;
}

const refreshCache = globalThis.__eurekaMarketplaceRefreshCache ??= new Map();

export function hasMarketplaceAccess(session: AuthSession | null) {
  return Boolean(session?.principal.permissions.includes(MARKETPLACE_PERMISSION));
}

export async function refreshMarketplaceSession(force = false): Promise<RefreshResult | null> {
  const current = await readAuthSession();
  if (!current) return null;
  const now = Date.now();
  for (const [key, entry] of refreshCache) {
    if (entry.expiresAt <= now) refreshCache.delete(key);
  }
  const remembered = getRememberedHazeAccessSession(current.refreshToken);
  if (remembered) return { session: remembered, refreshed: false };
  if (!force && current.expiresAt > now + 30_000) return { session: current, refreshed: false };
  const cached = refreshCache.get(current.refreshToken);
  if (cached && cached.expiresAt > now) return cached.result;
  const provider = getIdentityProvider();
  if (!provider) return null;
  const expiresAt = now + 45_000;
  const result = (async () => {
    try {
      const tokens = await provider.refresh(current.refreshToken);
      const principal = await provider.userInfo(tokens.accessToken);
      const session = { ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000, principal };
      const value = { session, refreshed: true };
      rememberHazeAccessSession(session);
      refreshCache.set(session.refreshToken, { expiresAt, result: Promise.resolve(value) });
      return value;
    } catch {
      return null;
    }
  })();
  refreshCache.set(current.refreshToken, { expiresAt, result });
  try {
    const refreshed = await result;
    if (!refreshed) refreshCache.delete(current.refreshToken);
    return refreshed;
  } catch {
    refreshCache.delete(current.refreshToken);
    return null;
  }
}
