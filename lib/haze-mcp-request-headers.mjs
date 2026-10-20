import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import nextEnv from "@next/env";
import { matchesHazeRuntimeSession, readHazeRuntimeState, refreshHazeRuntimeSession } from "./auth/haze-runtime-store.mjs";
import { validatePluginCredentialRequest } from "./haze-plugin-auth.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const guardIndex = process.argv.indexOf("--plugin-guard");
const guard = guardIndex < 0 ? null : JSON.parse(Buffer.from(process.argv[guardIndex + 1], "base64url").toString("utf8"));
const envelope = guard ? JSON.parse(input) : null;
if (guard && envelope.url !== guard.url) throw new Error("Plugin MCP request address was not approved");

nextEnv.loadEnvConfig(process.cwd(), undefined, { info() {}, error() {} });
const required = (name) => process.env[name]?.trim() || null;
const issuer = required("EUREKA_AUTH_HAZE_ISSUER")?.replace(/\/$/, "");
const clientId = required("EUREKA_AUTH_CLIENT_ID"), sessionSecret = required("EUREKA_AUTH_SESSION_SECRET");
if (!issuer || !clientId || !sessionSecret) throw new Error("Haze authentication is not configured");
const config = { issuer, clientId, sessionSecret, path: join(getAgentDir(), "eureka-haze-runtime-session.json") };
const initial = readHazeRuntimeState(config)?.session;
if (!initial) throw new Error("Haze login expired; please sign in to Haze again");
if (guard) validatePluginCredentialRequest(guard, envelope, issuer, initial);
const binding = { runtimeId: initial.runtimeId, subject: initial.principal.subject, providerId: initial.providerId };
const session = await refreshHazeRuntimeSession(config, binding, async (token) => {
  const response = await fetch(`${issuer}/api/oauth/token`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: token }), signal: AbortSignal.timeout(8000) });
  const tokens = await response.json().catch(() => null);
  if (!response.ok || !tokens?.access_token) throw new Error(`Unable to refresh Haze access token (${response.status}); please sign in to Haze again`);
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: Number(tokens.expires_in) };
});
const response = await fetch(`${issuer}/api/auth/me/mcp-credential`, {
  headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
const payload = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Haze MCP credential request failed (${response.status})`);
const credential = payload?.data?.key;
if (typeof credential !== "string" || !credential) throw new Error("Haze MCP credential response is invalid");
const latest = readHazeRuntimeState(config)?.session;
if (!matchesHazeRuntimeSession(latest, binding)) throw new Error("Haze login changed; please reconnect");
if (guard) validatePluginCredentialRequest(guard, envelope, issuer, latest);
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${credential}` }));
