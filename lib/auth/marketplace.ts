import "server-only";

import { MARKETPLACE_PERMISSION, getAuthConfig } from "@/lib/auth/config";
import { createHash } from "node:crypto";
import { extensionCatalogCache } from "../extension-catalog-cache";
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
      // Coalesce simultaneous directory/category/icon checks for the same
      // login. TTL zero discards the result immediately: later requests always
      // verify current permissions, and token rotation gets a different key.
      const key = "auth:" + createHash("sha256").update(JSON.stringify([getAuthConfig()?.issuer, session.providerId, session.runtimeId, session.principal.subject, session.accessToken])).digest("hex");
      const principal = await extensionCatalogCache.read(key, 0, () => provider.userInfo(session.accessToken!));
      if (principal.subject !== current.principal.subject) return null;
      return { session: { ...session, principal }, refreshed: true };
    } catch { return null; }
  }
  return { session, refreshed: current.refreshToken !== session.refreshToken };
}
