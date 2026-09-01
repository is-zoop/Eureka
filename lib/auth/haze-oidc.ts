import "server-only";

import { getAuthConfig } from "@/lib/auth/config";
import { IdentityProviderError, type AuthPrincipal, type IdentityProvider, type ProviderTokens } from "@/lib/auth/types";

type TokenPayload = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
type UserInfoPayload = { sub?: string; name?: string; phone?: string; email?: string | null; avatar_url?: string | null; permissions?: string[]; error?: string; error_description?: string };

function configOrThrow() {
  const config = getAuthConfig();
  if (!config) throw new Error("Marketplace identity provider is not configured");
  return config;
}

async function tokenRequest(values: Record<string, string>): Promise<ProviderTokens> {
  const config = configOrThrow();
  const response = await fetch(`${config.issuer}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, ...values }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as TokenPayload;
  if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) throw new IdentityProviderError(body.error ?? "token_exchange_failed", body.error_description ?? "Haze token exchange failed");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
}

export const hazeOidcProvider: IdentityProvider = {
  id: "haze-oidc",
  authorizationUrl({ state, codeChallenge }) {
    const config = configOrThrow();
    const url = new URL(`${config.issuer}/oauth/authorize`);
    // Eureka deliberately requires an explicit Haze credential check for each
    // new Eureka login instead of silently reusing the Haze SSO browser cookie.
    url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: "openid profile marketplace.read", state, code_challenge: codeChallenge, code_challenge_method: "S256", prompt: "login" }).toString();
    return url.toString();
  },
  exchangeCode({ code, verifier }) {
    return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: configOrThrow().redirectUri, code_verifier: verifier });
  },
  refresh(refreshToken) {
    return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  },
  async userInfo(accessToken) {
    const config = configOrThrow();
    const response = await fetch(`${config.issuer}/api/oauth/userinfo`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({})) as UserInfoPayload;
    if (!response.ok || !body.sub || !body.name) throw new IdentityProviderError(body.error ?? "userinfo_failed", body.error_description ?? "Haze user info request failed");
    return { subject: body.sub, name: body.name, phone: body.phone, email: body.email, avatarUrl: body.avatar_url, permissions: body.permissions ?? [] };
  },
};
