import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

// Shared by Next and the separate MCP header processes. The browser cookie
// identifies a login; it must never replace the latest rotating refresh token.
export function readHazeRuntimeState(config) {
  try {
    const stored = JSON.parse(readFileSync(config.path, "utf8"));
    const [iv, tag, ciphertext, ...extra] = String(stored.value ?? "").split(".");
    if (!iv || !tag || !ciphertext || extra.length) return null;
    const key = createHash("sha256").update(config.sessionSecret, "utf8").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    if (state.issuer !== config.issuer || state.clientId !== config.clientId
      || !state.session?.runtimeId || !state.session.refreshToken || !state.session.principal?.subject) return null;
    return state;
  } catch { return null; }
}

function writeState(config, state) {
  const key = createHash("sha256").update(config.sessionSecret, "utf8").digest();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const value = `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  const temporary = `${config.path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ value }), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, config.path);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function locked(config, work) {
  mkdirSync(dirname(config.path), { recursive: true });
  const release = await lockfile.lock(config.path, { realpath: false, stale: 20_000,
    retries: { retries: 80, minTimeout: 25, maxTimeout: 100 } });
  try { return await work(); } finally { await release(); }
}

export async function startHazeRuntimeSession(config, session) {
  return locked(config, () => {
    const current = { ...session, runtimeId: randomUUID() };
    writeState(config, { issuer: config.issuer, clientId: config.clientId, session: current });
    return current;
  });
}

export async function clearHazeRuntimeSession(config, binding = {}) {
  return locked(config, () => {
    if (Object.keys(binding).length && !matchesHazeRuntimeSession(readHazeRuntimeState(config)?.session, binding)) return false;
    try { unlinkSync(config.path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return true;
  });
}

export function matchesHazeRuntimeSession(session, binding) {
  return Boolean(session && (!binding.runtimeId || session.runtimeId === binding.runtimeId)
    && (!binding.subject || session.principal.subject === binding.subject)
    && (!binding.providerId || session.providerId === binding.providerId));
}

export async function refreshHazeRuntimeSession(config, binding, refresh) {
  return locked(config, async () => {
    const state = readHazeRuntimeState(config);
    if (!matchesHazeRuntimeSession(state?.session, binding)) throw new Error("Haze login changed or expired; please sign in again");
    const session = state.session;
    if (session.accessToken && session.expiresAt > Date.now() + 30_000) return session;
    const tokens = await refresh(session.refreshToken);
    if (!tokens?.accessToken || !tokens.refreshToken || !Number.isFinite(tokens.expiresIn) || tokens.expiresIn <= 0)
      throw new Error("Haze returned an invalid refreshed session");
    const updated = { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000 };
    // Persist rotation before any subsequent user-info or credential request.
    writeState(config, { ...state, session: updated });
    return updated;
  });
}
