import { browserOwner, clearBrowserIdentity } from "../browser-runtime";
import "server-only";

import { cookies } from "next/headers";
import { AUTH_SESSION_COOKIE, AUTH_TRANSACTION_COOKIE, getAuthConfig, MARKETPLACE_PERMISSION } from "@/lib/auth/config";
import { seal, unseal } from "@/lib/auth/crypto";
import { readAuthSessionValue } from "@/lib/auth/session-value";
import { clearRuntimeHazeSession, writeRuntimeHazeSession } from "@/lib/auth/runtime-session";
import type { AuthSession, AuthTransaction } from "@/lib/auth/types";
import { GUEST_SESSION_COOKIE, GUEST_SESSION_MAX_AGE, isGuestSessionValue } from "@/lib/auth/guest";

const YEAR = 60 * 60 * 24 * 365;
const TEN_MINUTES = 60 * 10;

export function isSafeReturnTo(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"));
}

export function authCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

type CookieWriter = { set: (name: string, value: string, options: ReturnType<typeof authCookieOptions>) => void };

export async function readGuestSession(): Promise<boolean> {
  return isGuestSessionValue((await cookies()).get(GUEST_SESSION_COOKIE)?.value);
}

export async function readAppSession(): Promise<{ guest: true } | { guest: false; session: AuthSession } | null> {
  if (await readGuestSession()) return { guest: true };
  const session = await readAuthSession();
  return session ? { guest: false, session } : null;
}

export function clearGuestSession(store: CookieWriter) {
  store.set(GUEST_SESSION_COOKIE, "", authCookieOptions(0));
}

export async function writeGuestSession(store: CookieWriter) {
  await clearAuthSession(store);
  clearTransaction(store);
  store.set(GUEST_SESSION_COOKIE, "1", authCookieOptions(GUEST_SESSION_MAX_AGE));
}

export async function readAuthSession(): Promise<AuthSession | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const store = await cookies();
  if (isGuestSessionValue(store.get(GUEST_SESSION_COOKIE)?.value)) return null;
  const rawSession = store.get(AUTH_SESSION_COOKIE)?.value;
  const session = readAuthSessionValue(rawSession);
  if (!session) {
    console.warn("[marketplace-auth] Session cookie unavailable:", {
      hasCookie: Boolean(rawSession),
      decrypts: Boolean(session),
      complete: false,
    });
    return null;
  }
  return session;
}

export async function writeAuthSession(store: CookieWriter, session: AuthSession) {
  const config = getAuthConfig();
  if (!config) throw new Error("Marketplace identity provider is not configured");
  const newLogin = !session.runtimeId;
  if (newLogin) session = await writeRuntimeHazeSession(session);
  // Keep the cookie small; access tokens stay in the encrypted host state.
  // Its login id, rather than this refresh-token snapshot, resolves rotation.
  const persistedSession = {
    ...session,
    accessToken: undefined,
    principal: {
      ...session.principal,
      // Haze allows avatar_url to be a data URL. An image must never be put in
      // a browser session cookie; the UI can request a profile image later.
      avatarUrl: undefined,
      // This verification-only integration needs one permission, not Haze's
      // potentially large complete capability list.
      permissions: session.principal.permissions.includes(MARKETPLACE_PERMISSION)
        ? [MARKETPLACE_PERMISSION]
        : [],
    },
  };
  if (newLogin) clearBrowserIdentity(browserOwner(config.issuer, session.principal.subject));
  store.set(AUTH_SESSION_COOKIE, seal(persistedSession, config.sessionSecret), authCookieOptions(YEAR));
  clearGuestSession(store);
}

export async function clearAuthSession(store: CookieWriter, binding?: AuthSession | null) {
  const cleared = await clearRuntimeHazeSession(binding);
  if (cleared !== false) clearBrowserIdentity();
  store.set(AUTH_SESSION_COOKIE, "", authCookieOptions(0));
}

export function writeTransaction(store: CookieWriter, transaction: AuthTransaction) {
  const config = getAuthConfig();
  if (!config) throw new Error("Marketplace identity provider is not configured");
  store.set(AUTH_TRANSACTION_COOKIE, seal(transaction, config.sessionSecret), authCookieOptions(TEN_MINUTES));
}

export function readTransaction(store: Awaited<ReturnType<typeof cookies>>): AuthTransaction | null {
  const config = getAuthConfig();
  if (!config) return null;
  const transaction = unseal<AuthTransaction>(store.get(AUTH_TRANSACTION_COOKIE)?.value, config.sessionSecret);
  if (!transaction || transaction.expiresAt < Date.now()) return null;
  return transaction;
}

export function clearTransaction(store: CookieWriter) {
  store.set(AUTH_TRANSACTION_COOKIE, "", authCookieOptions(0));
}
