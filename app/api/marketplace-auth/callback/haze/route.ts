import { NextRequest, NextResponse } from "next/server";
import { clearTransaction, readTransaction, writeAuthSession } from "@/lib/auth/session";
import { getIdentityProvider } from "@/lib/auth/provider";
import { AUTH_SESSION_COOKIE, getAuthConfig } from "@/lib/auth/config";
import { IdentityProviderError } from "@/lib/auth/types";

export async function GET(request: NextRequest) {
  // Next dev may build request.url with its internal localhost origin even when
  // the browser is at 127.0.0.1. Keep redirects on the same origin as the
  // registered callback, otherwise the browser will not send this Cookie.
  const appOrigin = getAuthConfig() ? new URL(getAuthConfig()!.redirectUri).origin : request.nextUrl.origin;
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const tx = readTransaction(store);
  const fail = (error: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, appOrigin));
    clearTransaction(response.cookies);
    return response;
  };
  const returnedState = request.nextUrl.searchParams.get("state");
  const providerError = request.nextUrl.searchParams.get("error");
  if (!tx || returnedState !== tx.state || providerError) {
    console.warn("[marketplace-auth] OAuth callback state rejected:", {
      hasTransaction: Boolean(tx),
      stateMatches: Boolean(tx && returnedState === tx.state),
      providerError: providerError ?? null,
    });
    return fail(providerError === "access_denied" ? "access_denied" : "callback_failed");
  }
  const code = request.nextUrl.searchParams.get("code");
  const provider = getIdentityProvider();
  if (!code || !provider || tx.providerId !== provider.id) return fail("callback_failed");
  try {
    const tokens = await provider.exchangeCode({ code, verifier: tx.verifier });
    const principal = await provider.userInfo(tokens.accessToken);
    const response = NextResponse.redirect(new URL(tx.returnTo, appOrigin));
    clearTransaction(response.cookies);
    writeAuthSession(response.cookies, { providerId: provider.id, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000, principal });
    const sessionCookie = response.cookies.get(AUTH_SESSION_COOKIE);
    console.info("[marketplace-auth] OAuth session cookie issued:", {
      present: Boolean(sessionCookie?.value),
      bytes: sessionCookie?.value.length ?? 0,
    });
    return response;
  } catch (error) {
    console.error("[marketplace-auth] Haze OAuth callback failed:", error instanceof Error ? error.message : error);
    return fail(error instanceof IdentityProviderError ? error.code : "callback_failed");
  }
}
