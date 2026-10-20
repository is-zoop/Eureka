import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { clearHazeRuntimeSession, readHazeRuntimeState, refreshHazeRuntimeSession, startHazeRuntimeSession } from "./haze-runtime-store.mjs";
import type { AuthSession } from "@/lib/auth/types";

function runtimeConfig() {
  const config = getAuthConfig();
  return config ? { ...config, path: join(getAgentDir(), "eureka-haze-runtime-session.json") } : null;
}

/** Initialize a new login; never call this with an old browser cookie. */
export async function writeRuntimeHazeSession(session: AuthSession): Promise<AuthSession> {
  const config = runtimeConfig();
  return config ? startHazeRuntimeSession(config, session) : session;
}

export function readRuntimeHazeSession(): AuthSession | null {
  const config = runtimeConfig();
  return config ? readHazeRuntimeState(config)?.session ?? null : null;
}

export async function refreshRuntimeHazeSession(binding?: AuthSession): Promise<AuthSession | null> {
  const config = runtimeConfig(), provider = getIdentityProvider();
  if (!config || !provider || (binding && !binding.runtimeId)) return null;
  try {
    return await refreshHazeRuntimeSession(config, binding ? {
      runtimeId: binding.runtimeId, subject: binding.principal.subject, providerId: binding.providerId,
    } : {}, (token: string) => provider.refresh(token));
  } catch { return null; }
}

export async function clearRuntimeHazeSession(binding?: AuthSession | null) {
  const config = runtimeConfig();
  if (!config || binding === null || (binding && !binding.runtimeId)) return false;
  return clearHazeRuntimeSession(config, binding ? { runtimeId: binding.runtimeId, subject: binding.principal.subject } : {});
}
