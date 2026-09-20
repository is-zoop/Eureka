import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "@/lib/auth/config";
import { seal, unseal } from "@/lib/auth/crypto";
import type { AuthSession } from "@/lib/auth/types";

function runtimeSessionPath() {
  return join(getAgentDir(), "eureka-haze-runtime-session.json");
}

/**
 * The browser cookie cannot be read by an AgentSession. Keep the same encrypted
 * Haze refresh session in the local agent directory so managed MCP connections
 * can request a fresh personal credential without exposing it in config/env.
 */
export function writeRuntimeHazeSession(session: AuthSession) {
  const config = getAuthConfig();
  if (!config) return;
  const path = runtimeSessionPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ value: seal({ ...session, accessToken: undefined }, config.sessionSecret) }), "utf8");
  renameSync(temporary, path);
}

export function readRuntimeHazeSession(): AuthSession | null {
  const config = getAuthConfig();
  const path = runtimeSessionPath();
  if (!config || !existsSync(path)) return null;
  try {
    const stored = JSON.parse(readFileSync(path, "utf8")) as { value?: string };
    const session = unseal<AuthSession>(stored.value, config.sessionSecret);
    return session?.refreshToken && session.principal?.subject ? session : null;
  } catch {
    return null;
  }
}

export function clearRuntimeHazeSession() {
  const path = runtimeSessionPath();
  if (!existsSync(path)) return;
  try { unlinkSync(path); } catch { /* best effort logout cleanup */ }
}
