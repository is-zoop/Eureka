import { NextResponse } from "next/server";
import { clearAuthSession, clearGuestSession, clearTransaction } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ loggedOut: true });
  clearAuthSession(response.cookies);
  clearGuestSession(response.cookies);
  clearTransaction(response.cookies);
  return response;
}
