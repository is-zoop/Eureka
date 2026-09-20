import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import nextEnv from "@next/env";

for await (const _chunk of process.stdin) { /* drain the adapter envelope */ }

// The adapter launches this as a separate Node process. Load the same .env
// files as Next before reading Haze configuration from process.env.
nextEnv.loadEnvConfig(process.cwd());

const required = (name) => process.env[name]?.trim() || null;
const issuer = required("EUREKA_AUTH_HAZE_ISSUER")?.replace(/\/$/, "");
const clientId = required("EUREKA_AUTH_CLIENT_ID");
const secret = required("EUREKA_AUTH_SESSION_SECRET");
if (!issuer || !clientId || !secret) throw new Error("Haze authentication is not configured");

const runtimeSessionPath = join(getAgentDir(), "eureka-haze-runtime-session.json");
const encryptionKey = createHash("sha256").update(secret, "utf8").digest();

async function readRuntimeSession() {
  const stored = JSON.parse(await readFile(runtimeSessionPath, "utf8"));
  const [iv, tag, ciphertext, ...extra] = String(stored.value ?? "").split(".");
  if (!iv || !tag || !ciphertext || extra.length) throw new Error("Haze runtime session is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const session = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
  if (typeof session?.refreshToken !== "string" || !session.refreshToken) throw new Error("Haze runtime session is unavailable");
  return session;
}

async function writeRuntimeSession(session, tokens) {
  if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw new Error("Haze did not return a refreshed token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const value = { ...session, accessToken: undefined, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in || 0) * 1000 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const sealed = `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  await mkdir(dirname(runtimeSessionPath), { recursive: true });
  const temporary = `${runtimeSessionPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify({ value: sealed }), "utf8");
  await rename(temporary, runtimeSessionPath);
}

async function refresh(session) {
  const response = await fetch(`${issuer}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: session.refreshToken }) });
  return { response, tokens: await response.json().catch(() => null) };
}

let session = await readRuntimeSession();
let refreshed = await refresh(session);
// Multiple MCPs can connect together. If another hook has already rotated the
// token, retry once with the new encrypted runtime session it saved.
if (!refreshed.response.ok || !refreshed.tokens?.access_token) {
  const latest = await readRuntimeSession();
  if (latest.refreshToken !== session.refreshToken) {
    session = latest;
    refreshed = await refresh(session);
  }
}
if (!refreshed.response.ok || !refreshed.tokens?.access_token) throw new Error("Unable to refresh Haze access token; please sign in to Haze again");
await writeRuntimeSession(session, refreshed.tokens);
// Haze accepts the OAuth access token here and returns the current personal
// credential. The key is kept only in this child process and is requested on
// every new MCP connection, so a credential reset is picked up automatically.
const credentialResponse = await fetch(`${issuer}/api/auth/me/mcp-credential`, { headers: { Authorization: `Bearer ${refreshed.tokens.access_token}`, Accept: "application/json" } });
const credentialPayload = await credentialResponse.json();
if (!credentialResponse.ok) throw new Error(`Haze MCP credential request failed (${credentialResponse.status})`);
const credential = credentialPayload?.data?.key;
if (typeof credential !== "string" || !credential) throw new Error("Haze MCP credential response is invalid");
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${credential}` }));
