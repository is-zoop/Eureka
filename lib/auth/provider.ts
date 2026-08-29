import "server-only";

import { getAuthConfig } from "@/lib/auth/config";
import { hazeOidcProvider } from "@/lib/auth/haze-oidc";
import type { IdentityProvider } from "@/lib/auth/types";

export function getIdentityProvider(): IdentityProvider | null {
  const config = getAuthConfig();
  if (!config) return null;
  if (config.provider === "haze-oidc") return hazeOidcProvider;
  return null;
}
