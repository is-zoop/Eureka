import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "../../lib/auth/config";
import { readRuntimeHazeSession } from "../../lib/auth/runtime-session";
import { matchesHazeRuntimeSession, refreshHazeRuntimeSession } from "../../lib/auth/haze-runtime-store.mjs";

export interface HazeMcpIdentity {
  source: string;
  subject: string;
  runtimeId: string;
  providerId: string;
}

export class HazeMcpAuthError extends Error {}

export function assertHazeMcpIdentity(binding: HazeMcpIdentity): void {
  const config = getAuthConfig();
  if (!config || config.issuer !== binding.source || !matchesHazeRuntimeSession(readRuntimeHazeSession(), binding)) {
    throw new HazeMcpAuthError("Haze 登录已失效或账号已变化，请重新登录并重载会话。");
  }
}

/** Fresh personal MCP key per HTTP request; only OAuth rotation is persisted. */
export async function resolveHazeNativeMcpHeaders(binding: HazeMcpIdentity, signal?: AbortSignal | null): Promise<Record<string, string>> {
  signal?.throwIfAborted();
  assertHazeMcpIdentity(binding);
  const config = getAuthConfig()!;
  const session = await refreshHazeRuntimeSession({ ...config, path: join(getAgentDir(), "eureka-haze-runtime-session.json") }, binding, async (token: string) => {
    // A refresh may rotate the token. Finish and persist it under the shared
    // file lock even when the requesting MCP operation was cancelled meanwhile.
    const response = await fetch(`${config.issuer}/api/oauth/token`, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, grant_type: "refresh_token", refresh_token: token }),
      signal: AbortSignal.timeout(8000),
    });
    const tokens = await response.json().catch(() => null);
    if (!response.ok || !tokens?.access_token) throw new HazeMcpAuthError(`Haze 登录刷新失败（${response.status}），请重新登录。`);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: Number(tokens.expires_in) };
  }).catch(() => { throw new HazeMcpAuthError("Haze 登录刷新失败，请重新登录并重载会话。"); });
  signal?.throwIfAborted();
  assertHazeMcpIdentity(binding);
  const response = await fetch(`${config.issuer}/api/auth/me/mcp-credential`, {
    redirect: "error", headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.data?.key !== "string" || !payload.data.key) {
    throw new HazeMcpAuthError(`Haze MCP 凭证获取失败（${response.status}），请检查登录与服务权限。`);
  }
  signal?.throwIfAborted();
  assertHazeMcpIdentity(binding);
  return { Authorization: `Bearer ${payload.data.key}` };
}
