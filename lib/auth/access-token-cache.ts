import "server-only";

import type { AuthSession } from "@/lib/auth/types";

declare global {
  var __eurekaHazeAccessSessions: Map<string, AuthSession> | undefined;
}

const accessSessions = globalThis.__eurekaHazeAccessSessions ??= new Map<string, AuthSession>();

export function rememberHazeAccessSession(session: AuthSession) {
  if (!session.accessToken) return;
  accessSessions.set(session.refreshToken, session);
}

export function getRememberedHazeAccessSession(refreshToken: string) {
  const session = accessSessions.get(refreshToken);
  if (!session?.accessToken || session.expiresAt <= Date.now() + 30_000) {
    accessSessions.delete(refreshToken);
    return null;
  }
  return session;
}
