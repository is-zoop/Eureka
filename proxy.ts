import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/config";
import { readAuthSessionValue } from "@/lib/auth/session-value";
import { GUEST_SESSION_COOKIE, isGuestSessionValue } from "@/lib/auth/guest";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApiRequest = pathname === "/api"
    || pathname.startsWith("/api/");
  // OAuth redirects are necessarily cross-site. The callback verifies its
  // encrypted, short-lived state cookie and PKCE code verifier itself, so only
  // this exact navigation may bypass the generic Origin/Sec-Fetch-Site check.
  const isOAuthNavigation = pathname === "/api/marketplace-auth/callback/haze"
    || pathname === "/api/marketplace-auth/start";
  const isTrustedRequest = isOAuthNavigation
    ? isApiRequestHostAllowed(request)
    : isApiRequest
      ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    console.warn("[request-security] Rejected request", {
      pathname,
      host: request.headers.get("host"),
      fetchSite: request.headers.get("sec-fetch-site"),
      oauthNavigation: isOAuthNavigation,
    });
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const isPublicPage = pathname === "/login";
  const isMarketplaceAuthRoute = pathname.startsWith("/api/marketplace-auth/");
  if (!isPublicPage && !isMarketplaceAuthRoute) {
    const guest = isGuestSessionValue(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
    if (guest && (pathname === "/api/organization-extensions" || pathname.startsWith("/api/organization-extensions/"))) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const session = readAuthSessionValue(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    if (!session && !guest) {
      if (isApiRequest) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ["/api/organization-extensions/:path*", "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|sw.js|workbox-|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"] };
