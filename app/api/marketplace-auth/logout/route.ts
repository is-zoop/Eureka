import { NextResponse } from "next/server";
import { clearAuthSession, clearGuestSession, clearTransaction, readAuthSession } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ loggedOut: true });
  await clearAuthSession(response.cookies, await readAuthSession());
  clearGuestSession(response.cookies);
  clearTransaction(response.cookies);
  return response;
}
