import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSession } from "./types";

const LIFETIME = 10 * 60 * 1000;
type Entry = {
  claimToken: string;
  expiresAt: number;
  returnTo: string;
  state?: string;
  session?: AuthSession;
  error?: string;
};
type Claim = { status: "pending" } | { status: "failed"; error: string }
  | { status: "complete"; session: AuthSession; returnTo: string };

/** OAuth results stay server-side; only the initiating desktop can claim them. */
export class DesktopLoginStore {
  private entries = new Map<string, Entry>();
  constructor(private now: () => number = Date.now) {}

  private get(id: string) {
    const entry = this.entries.get(id);
    if (entry && entry.expiresAt > this.now()) return entry;
    this.entries.delete(id);
  }

  start(returnTo: string) {
    for (const id of this.entries.keys()) this.get(id);
    if (this.entries.size >= 128) throw new Error("Too many pending desktop logins");
    const requestId = randomBytes(32).toString("base64url");
    const claimToken = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + LIFETIME;
    this.entries.set(requestId, { claimToken, returnTo, expiresAt });
    return { requestId, claimToken, expiresAt };
  }

  bind(id: string, state: string): boolean {
    const entry = this.get(id);
    if (!entry || entry.state) return false;
    entry.state = state;
    return true;
  }

  complete(id: string, state: string, session: AuthSession): boolean {
    const entry = this.get(id);
    if (!entry || entry.state !== state || entry.session || entry.error) return false;
    entry.session = session;
    return true;
  }

  fail(id: string, state: string, error: string) {
    const entry = this.get(id);
    if (entry?.state === state && !entry.session) entry.error = error;
  }

  private authorized(id: string, token: string) {
    const entry = this.get(id);
    if (!entry) return;
    const actual = Buffer.from(token);
    const expected = Buffer.from(entry.claimToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? entry : undefined;
  }

  claim(id: string, token: string): Claim | null {
    const entry = this.authorized(id, token);
    if (!entry) return null;
    if (entry.session) {
      this.entries.delete(id);
      return { status: "complete", session: entry.session, returnTo: entry.returnTo };
    }
    if (entry.error) {
      this.entries.delete(id);
      return { status: "failed", error: entry.error };
    }
    return { status: "pending" };
  }

  cancel(id: string, token: string) {
    if (this.authorized(id, token)) this.entries.delete(id);
  }
}

declare global {
  var __eurekaDesktopLogins: DesktopLoginStore | undefined;
}
export const desktopLogins = globalThis.__eurekaDesktopLogins ??= new DesktopLoginStore();
