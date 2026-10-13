import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { clearTransaction, isSafeReturnTo, writeTransaction } from "@/lib/auth/session";
import { desktopLogins } from "@/lib/auth/desktop-login-store";

const toBase64Url = (value: Buffer) => value.toString("base64url");

export async function GET(request: NextRequest) {
  const authConfig = getAuthConfig();
  if (authConfig) {
    const callbackOrigin = new URL(authConfig.redirectUri).origin;
    const requestOrigin = new URL(`${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`).origin;
    if (requestOrigin !== callbackOrigin) {
      const canonicalStart = new URL("/api/marketplace-auth/start", callbackOrigin);
      canonicalStart.searchParams.set("returnTo", request.nextUrl.searchParams.get("returnTo") ?? "/");
      const desktopRequest = request.nextUrl.searchParams.get("desktopRequest");
      if (desktopRequest) canonicalStart.searchParams.set("desktopRequest", desktopRequest);
      return NextResponse.redirect(canonicalStart);
    }
  }
  const provider = getIdentityProvider();
  const fallback = new URL("/login?error=not_configured", request.url);
  if (!provider) return NextResponse.redirect(fallback);
  const state = toBase64Url(randomBytes(24));
  const desktopRequestId = request.nextUrl.searchParams.get("desktopRequest") ?? undefined;
  if (desktopRequestId && !desktopLogins.bind(desktopRequestId, state)) {
    return NextResponse.redirect(new URL("/login?desktop=failed", authConfig ? new URL(authConfig.redirectUri).origin : request.url));
  }
  const verifier = toBase64Url(randomBytes(48));
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const returnTo = isSafeReturnTo(request.nextUrl.searchParams.get("returnTo")) ? request.nextUrl.searchParams.get("returnTo")! : "/";
  const response = NextResponse.redirect(provider.authorizationUrl({ state, codeChallenge }));
  clearTransaction(response.cookies);
  writeTransaction(response.cookies, { providerId: provider.id, state, verifier, returnTo, expiresAt: Date.now() + 10 * 60 * 1000, desktopRequestId });
  return response;
}
