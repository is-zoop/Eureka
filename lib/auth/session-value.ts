import "server-only";

import { getAuthConfig } from "@/lib/auth/config";
import { unseal } from "@/lib/auth/crypto";
import type { AuthSession } from "@/lib/auth/types";

/**
 * Validate the encrypted browser cookie without depending on Next's request
 * storage. This is shared by Route Handlers, Server Components, and Proxy.
 */
export function readAuthSessionValue(value: string | undefined): AuthSession | null {
  const config = getAuthConfig();
  if (!config) return null;
  const session = unseal<AuthSession>(value, config.sessionSecret);
  if (!session || !session.refreshToken || !session.principal?.subject) return null;
  return session;
}
