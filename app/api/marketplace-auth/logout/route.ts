import { NextResponse } from "next/server";
import { clearAuthSession, clearTransaction } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ loggedOut: true });
  clearAuthSession(response.cookies);
  clearTransaction(response.cookies);
  return response;
}
