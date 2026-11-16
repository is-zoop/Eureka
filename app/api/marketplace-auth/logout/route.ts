import { NextResponse } from "next/server";
import { authCookieOptions, clearAuthSession, clearTransaction, readAuthSession } from "@/lib/auth/session";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_MAX_AGE } from "@/lib/auth/guest";

export async function POST() {
  const response = NextResponse.json({ loggedOut: true });
  await clearAuthSession(response.cookies, await readAuthSession());
  response.cookies.set(GUEST_SESSION_COOKIE,"1",authCookieOptions(GUEST_SESSION_MAX_AGE));
  clearTransaction(response.cookies);
  return response;
}
