import "server-only";

export type AuthConfig = {
  provider: "haze-oidc";
  issuer: string;
  clientId: string;
  redirectUri: string;
  sessionSecret: string;
};

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function getAuthConfig(): AuthConfig | null {
  const provider = required("EUREKA_AUTH_PROVIDER") ?? "haze-oidc";
  const issuer = required("EUREKA_AUTH_HAZE_ISSUER");
  const clientId = required("EUREKA_AUTH_CLIENT_ID");
  const redirectUri = required("EUREKA_AUTH_REDIRECT_URI");
  const sessionSecret = required("EUREKA_AUTH_SESSION_SECRET");
  if (!issuer || !clientId || !redirectUri || !sessionSecret || sessionSecret.length < 32 || provider !== "haze-oidc") return null;
  return { provider, issuer: issuer.replace(/\/$/, ""), clientId, redirectUri, sessionSecret };
}

export const AUTH_SESSION_COOKIE = "eureka_marketplace_session";
export const AUTH_TRANSACTION_COOKIE = "eureka_marketplace_oauth";
export const MARKETPLACE_PERMISSION = "page.marketplace";
