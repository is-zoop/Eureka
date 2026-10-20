import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { clearHazeRuntimeSession, readHazeRuntimeState, refreshHazeRuntimeSession, startHazeRuntimeSession } from "./haze-runtime-store.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "eureka-haze-auth-"));
  const state = { rotations: 0, rejectedRefreshes: 0, credentials: 0, key: "test-personal-key-one", refresh: "test-refresh-seed", access: null, failProfile: false };
  const server = createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.url === "/api/oauth/token") {
      let body = ""; for await (const chunk of request) body += chunk;
      if (new URLSearchParams(body).get("refresh_token") !== state.refresh) {
        state.rejectedRefreshes++; return send(400, { error: "invalid_grant" });
      }
      state.rotations++;
      state.refresh = `test-rotated-${state.rotations}`;
      state.access = `test-access-${state.rotations}`;
      await new Promise((done) => setTimeout(done, 30));
      return send(200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600 });
    }
    if (!state.access || request.headers.authorization !== `Bearer ${state.access}`) return send(401, {});
    if (request.url === "/api/oauth/userinfo") return send(state.failProfile ? 503 : 200, { sub: "user-a", name: "Test", permissions: ["page.marketplace"] });
    if (request.url === "/api/auth/me/mcp-credential") {
      state.credentials++;
      if (state.waitForCredential) { state.credentialStarted(); await state.waitForCredential; }
      return send(200, { data: { key: state.key } });
    }
    send(404, {});
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const issuer = `http://127.0.0.1:${server.address().port}`;
  const config = { path: join(root, "eureka-haze-runtime-session.json"), issuer, clientId: "test-client", sessionSecret: "test-only-secret-with-at-least-32-characters" };
  const session = { providerId: "haze-oidc", refreshToken: state.refresh, expiresAt: 0, principal: { subject: "user-a", name: "Test", permissions: ["page.marketplace"] } };
  const login = await startHazeRuntimeSession(config, session);
  const env = { PI_CODING_AGENT_DIR: root, EUREKA_AUTH_HAZE_ISSUER: issuer, EUREKA_AUTH_CLIENT_ID: config.clientId,
    EUREKA_AUTH_SESSION_SECRET: config.sessionSecret, EUREKA_AUTH_REDIRECT_URI: "http://localhost/callback" };
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); });
  const refresh = async (token) => {
    const response = await fetch(`${issuer}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ refresh_token: token }) });
    const data = await response.json();
    if (!response.ok) throw new Error("Refresh rejected");
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  };
  const hook = (overrides = {}) => new Promise((done, reject) => {
    const guard = { source: issuer, subject: "user-a", url: "http://localhost:3000/api/mcp", ...overrides };
    const child = spawn(process.execPath, [resolve("lib/haze-mcp-request-headers.mjs"), "--plugin-guard", Buffer.from(JSON.stringify(guard)).toString("base64url")],
      { cwd: process.cwd(), env: { ...process.env, ...env }, windowsHide: true, timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject); child.on("close", (code) => done({ code, output, error }));
    child.stdin.end(JSON.stringify({ url: "http://localhost:3000/api/mcp" }));
  });
  return { root, config, state, login, session, env, refresh, hook };
}

test("Next and independent MCP processes share single-use token rotation", async (t) => {
  const f = await fixture(t);
  const binding = { runtimeId: f.login.runtimeId, subject: "user-a" };
  const results = await Promise.all([refreshHazeRuntimeSession(f.config, binding, f.refresh), f.hook(), f.hook(), f.hook()]);
  assert.equal(results[0].accessToken, "test-access-1");
  for (const result of results.slice(1)) { assert.equal(result.code, 0, result.error); assert.equal(JSON.parse(result.output).Authorization, `Bearer ${f.state.key}`); }
  assert.equal(f.state.rotations, 1); assert.equal(f.state.rejectedRefreshes, 0);
  assert.equal(readHazeRuntimeState(f.config).session.refreshToken, f.state.refresh);
  const disk = await readFile(f.config.path, "utf8");
  for (const secret of [f.state.refresh, f.state.access, f.state.key]) assert.ok(!disk.includes(secret));
  f.state.key = "test-personal-key-reset";
  assert.equal(JSON.parse((await f.hook()).output).Authorization, "Bearer test-personal-key-reset");
  assert.equal(f.state.rotations, 1, "valid access token should be reused, personal credential must be fetched again");
});

test("old cookie resolves current rotation without rewriting it or recovering another login", async (t) => {
  const f = await fixture(t);
  await refreshHazeRuntimeSession(f.config, { runtimeId: f.login.runtimeId }, f.refresh);
  const old = await refreshHazeRuntimeSession(f.config, { runtimeId: f.login.runtimeId }, f.refresh);
  assert.notEqual(old.refreshToken, f.login.refreshToken);
  const next = await startHazeRuntimeSession(f.config, { ...f.session, principal: { ...f.session.principal, subject: "user-b" } });
  await assert.rejects(refreshHazeRuntimeSession(f.config, { runtimeId: f.login.runtimeId }, f.refresh), /login changed/);
  assert.equal(await clearHazeRuntimeSession(f.config, { runtimeId: f.login.runtimeId }), false);
  assert.equal(readHazeRuntimeState(f.config).session.runtimeId, next.runtimeId);
  assert.equal(readHazeRuntimeState({ ...f.config, issuer: "http://another-issuer" }), null);
  assert.equal(readHazeRuntimeState({ ...f.config, clientId: "another-client" }), null);
  for (const overrides of [{ subject: "user-a" }, { source: "http://another-issuer" }, { url: "http://unapproved" }]) {
    const failed = await f.hook(overrides); assert.notEqual(failed.code, 0); assert.equal(failed.output, "");
  }
  assert.equal(f.state.credentials, 0);
});

test("logout while a personal credential is fetched rejects the result and does not resurrect login", async (t) => {
  const f = await fixture(t);
  let release;
  f.state.waitForCredential = new Promise((done) => { release = done; });
  const started = new Promise((done) => { f.state.credentialStarted = done; });
  const pending = f.hook(); await started;
  await clearHazeRuntimeSession(f.config);
  release(); const result = await pending;
  assert.notEqual(result.code, 0); assert.equal(result.output, "");
  assert.equal(readHazeRuntimeState(f.config), null);
  assert.ok(!result.error.includes(f.state.key)); assert.ok(!result.error.includes(f.state.access));
});

test("failed refresh preserves the encrypted login and cannot emit credentials; a new login recovers", async (t) => {
  const f = await fixture(t);
  f.state.refresh = "test-replacement-login";
  const before = await readFile(f.config.path, "utf8");
  const failed = await f.hook();
  assert.notEqual(failed.code, 0); assert.equal(failed.output, "");
  assert.match(failed.error, /Unable to refresh Haze access token \(400\)/);
  assert.equal(await readFile(f.config.path, "utf8"), before);
  assert.equal(f.state.credentials, 0);
  for (const secret of [f.login.refreshToken, f.state.refresh, f.state.key]) assert.ok(!failed.error.includes(secret));
  const login = await startHazeRuntimeSession(f.config, { ...f.session, refreshToken: f.state.refresh });
  assert.notEqual(login.runtimeId, f.login.runtimeId);
  assert.equal((await f.hook()).code, 0);
});

test("cookie and marketplace paths use shared rotation and preserve it when user-info fails", async (t) => {
  const f = await fixture(t);
  const previous = Object.fromEntries(Object.keys(f.env).map((key) => [key, process.env[key]])); Object.assign(process.env, f.env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const cookieStub = join(f.root, "cookie.cjs");
  await writeFile(cookieStub, "exports.cookies = async () => ({get: (name) => name === 'eureka_marketplace_session' ? {value: globalThis.__hazeAuthCookieTest} : undefined});");
  t.after(() => { delete globalThis.__hazeAuthCookieTest; });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: {
    "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js"),
    "next/headers": cookieStub,
  } });
  const { seal } = await jiti.import("./crypto.ts");
  const setCookie = (session) => { globalThis.__hazeAuthCookieTest = seal(session, f.config.sessionSecret); };
  setCookie(f.login);
  const { refreshMarketplaceSession } = await jiti.import("./marketplace.ts");
  f.state.failProfile = true;
  assert.equal(await refreshMarketplaceSession(true), null);
  assert.equal(f.state.rotations, 1);
  f.state.failProfile = false;
  const result = await refreshMarketplaceSession(true);
  assert.equal(result.session.runtimeId, f.login.runtimeId);
  assert.equal(result.session.accessToken, f.state.access);
  assert.equal(f.state.rotations, 1);
  assert.equal(f.state.rejectedRefreshes, 0);
  setCookie({ ...f.login, runtimeId: "old-login" });
  assert.equal(await refreshMarketplaceSession(true), null);
  setCookie(f.session); // Cookies predating login binding must reauthenticate.
  assert.equal(await refreshMarketplaceSession(true), null);
});
