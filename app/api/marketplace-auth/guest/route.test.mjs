import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const fixtures = await mkdtemp(path.join(tmpdir(), "eureka-guest-auth-test-"));
after(() => rm(fixtures, { recursive: true, force: true }));
await mkdir(path.join(fixtures, "lib/auth"), { recursive: true });
for (const name of ["session", "session-value", "guest", "crypto", "access-token-cache", "types"]) {
  await writeFile(path.join(fixtures, `lib/auth/${name}.ts`), await readFile(`lib/auth/${name}.ts`));
}
await writeFile(path.join(fixtures, "lib/request-security.ts"), await readFile("lib/request-security.ts"));
await writeFile(path.join(fixtures, "lib/auth/config.ts"), `
exports.AUTH_SESSION_COOKIE = "eureka_marketplace_session";
exports.AUTH_TRANSACTION_COOKIE = "eureka_marketplace_oauth";
exports.MARKETPLACE_PERMISSION = "page.marketplace";
exports.getAuthConfig = () => globalThis.__guestAuthConfigEnabled ? {
  provider: "haze-oidc", issuer: "https://haze.test", clientId: "test-client",
  redirectUri: "http://127.0.0.1:8080/api/marketplace-auth/callback/haze",
  sessionSecret: "a-test-only-secret-that-is-long-enough"
} : null;
`);
await writeFile(path.join(fixtures, "headers.cjs"), "exports.cookies = async () => globalThis.__guestAuthCookies;");
await writeFile(path.join(fixtures, "lib/auth/runtime-session.ts"), `
exports.clearRuntimeHazeSession = () => { globalThis.__guestRuntimeCleared = true; };
exports.writeRuntimeHazeSession = (session) => ({...session, runtimeId:"test-login"});
exports.readRuntimeHazeSession = () => { globalThis.__guestRuntimeRead = true; return globalThis.__guestStaleSession; };
`);
await writeFile(path.join(fixtures, "lib/auth/provider.ts"), "exports.getIdentityProvider = () => { throw new Error('guest must not contact Haze'); };");
await writeFile(path.join(fixtures, "lib/auth/marketplace.ts"), `
exports.refreshMarketplaceSession = async () => { throw new Error("guest must not refresh Haze"); };
exports.hasMarketplaceAccess = () => false;
`);
await writeFile(path.join(fixtures, "lib/browser-runtime.ts"), `exports.browserOwner = (source, subject) => JSON.stringify([source, subject]); exports.clearBrowserIdentity = () => {};`);
const jiti = createJiti(import.meta.url, { alias: {
  "@": fixtures,
  "next/server": import.meta.resolve("next/server.js"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js"),
  "next/headers": path.join(fixtures, "headers.cjs"),
} });
const { NextRequest, NextResponse } = await jiti.import("next/server");
const { POST: enterGuest } = await jiti.import("./route.ts");
const { GET: profile } = await jiti.import("../session/route.ts");
const { POST: logout } = await jiti.import("../logout/route.ts");
const { proxy, config } = await jiti.import("../../../../proxy.ts");
const { readAppSession, readAuthSession, writeAuthSession } = await jiti.import("@/lib/auth/session");
const { GUEST_SESSION_COOKIE, GUEST_SESSION_MAX_AGE, guestReturnTo, isGuestSessionValue } = await jiti.import("@/lib/auth/guest");
const { getHazeMarketplaceSession } = await jiti.import("../../../../lib/organization-extensions.ts");

const request = (pathname, options = {}) => new NextRequest(`http://127.0.0.1:8080${pathname}`, {
  ...options, headers: { host: "127.0.0.1:8080", ...options.headers },
});
const skip = (returnTo = "/") => enterGuest(request("/api/marketplace-auth/guest", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnTo }),
}));

test("explicit guest entry works without Haze configuration and persists for a year", async () => {
  globalThis.__guestAuthConfigEnabled = false;
  globalThis.__guestRuntimeCleared = false;
  const response = await skip("/?session=123");
  assert.deepEqual(await response.json(), { guest: true, returnTo: "/?session=123" });
  const cookie = response.cookies.get(GUEST_SESSION_COOKIE);
  assert.equal(cookie.value, "1");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/");
  assert.equal(cookie.maxAge, GUEST_SESSION_MAX_AGE);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.cookies.get("eureka_marketplace_session").maxAge, 0);
  assert.equal(response.cookies.get("eureka_marketplace_oauth").maxAge, 0);
  assert.equal(globalThis.__guestRuntimeCleared, true);
  globalThis.__guestAuthCookies = response.cookies;
  assert.deepEqual(await readAppSession(), { guest: true });
  assert.equal(await readAuthSession(), null);
  const first = await profile();
  assert.equal(first.status, 200);
  const expected = { authenticated: false, guest: true, marketplace: false,
    user: { name: "不愿意透露姓名的神秘用户", email: null, avatarUrl: "/icons/guest-avatar.png", permissions: [] } };
  assert.deepEqual(await first.json(), expected);
  assert.deepEqual(await (await profile()).json(), expected);
});

test("guest redirects preserve app state but cannot loop into login, enterprise, or API routes", () => {
  for (const target of ["/", "/?session=abc#message", "/settings?tab=models"]) assert.equal(guestReturnTo(target), target);
  for (const target of [undefined, "https://outside.test", "//outside.test", "/\\outside.test", "/login?returnTo=/",
    "/marketplace", "/marketplace/", "/api/agent/new", "/%6cogin", "/settings/../login", "/%", "/\noutside.test"]) {
    assert.equal(guestReturnTo(target), "/");
  }
  assert.equal(isGuestSessionValue("1"), true);
  for (const value of [undefined, "true", "0", ""]) assert.equal(isGuestSessionValue(value), false);
});

test("ordinary pages and APIs accept guests; requests without an explicit choice remain gated", () => {
  globalThis.__guestAuthConfigEnabled = false;
  for (const target of ["/", "/settings", "/api/sessions", "/api/agent/new", "/api/models", "/api/skills", "/api/plugins", "/api/mcp-config"]) {
    const response = proxy(request(target, { headers: { cookie: `${GUEST_SESSION_COOKIE}=1` } }));
    assert.equal(response.headers.get("x-middleware-next"), "1", target);
  }
  assert.equal(proxy(request("/")).status, 307);
  assert.equal(proxy(request("/api/sessions")).status, 401);
  assert.equal(proxy(request("/api/sessions", { headers: { cookie: `${GUEST_SESSION_COOKIE}=0` } })).status, 401);
});

test("guests cannot access any enterprise route, including resources and local installation management", async () => {
  for (const suffix of ["", "/categories", "/installations", "/1/content", "/1/icon", "/1/favorite", "/1/installation", "/1/documentation/image.png"]) {
    const response = proxy(request(`/api/organization-extensions${suffix}`, { headers: { cookie: `${GUEST_SESSION_COOKIE}=1` } }));
    assert.equal(response.status, 401, suffix);
    assert.deepEqual(await response.json(), { error: "unauthenticated" });
  }
  assert.ok(config.matcher.includes("/api/organization-extensions/:path*"));
  globalThis.__guestRuntimeRead = false;
  globalThis.__guestAuthCookies = (await skip()).cookies;
  await assert.rejects(getHazeMarketplaceSession(), error => error.kind === "unauthenticated");
  assert.equal(globalThis.__guestRuntimeRead, false);
});

test("guest access never bypasses request origin checks", async () => {
  const crossSite = request("/api/marketplace-auth/guest", { method: "POST", headers: {
    "Content-Type": "application/json", origin: "https://outside.test", "sec-fetch-site": "cross-site",
  }, body: "{}" });
  assert.equal((await enterGuest(crossSite)).status, 403);
  assert.equal(proxy(request("/api/sessions", { headers: { cookie: `${GUEST_SESSION_COOKIE}=1`, origin: "https://outside.test" } })).status, 403);
  assert.equal((await enterGuest(request("/api/marketplace-auth/guest", { method: "POST", body: "{}" }))).status, 415);
  assert.equal((await enterGuest(request("/api/marketplace-auth/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" }))).status, 400);
});

test("successful login replaces guest mode; logout clears both modes", async () => {
  globalThis.__guestAuthConfigEnabled = true;
  const response = NextResponse.json({});
  const session = { providerId: "haze-oidc", refreshToken: "test-refresh", expiresAt: Date.now() + 3600000,
    principal: { subject: "test-user", name: "Test", permissions: [] } };
  await writeAuthSession(response.cookies, session);
  assert.equal(response.cookies.get(GUEST_SESSION_COOKIE).maxAge, 0);
  globalThis.__guestAuthCookies = response.cookies;
  assert.deepEqual(await readAppSession(), { guest: false, session: { ...session, runtimeId: "test-login" } });
  globalThis.__guestAuthCookies = (await skip()).cookies;
  const loggedOut = await logout();
  assert.equal(loggedOut.cookies.get(GUEST_SESSION_COOKIE).maxAge, 0);
  assert.equal(loggedOut.cookies.get("eureka_marketplace_session").maxAge, 0);
  globalThis.__guestAuthCookies = loggedOut.cookies;
  assert.equal(await readAppSession(), null);
});

test("an explicit guest choice overrides a residual valid Haze cookie", async () => {
  globalThis.__guestAuthConfigEnabled = true;
  const response = NextResponse.json({});
  await writeAuthSession(response.cookies, { providerId: "haze-oidc", refreshToken: "stale-refresh", expiresAt: Date.now() + 3600000,
    principal: { subject: "previous-user", name: "Previous User", permissions: ["page.marketplace"] } });
  response.cookies.set(GUEST_SESSION_COOKIE, "1");
  globalThis.__guestAuthCookies = response.cookies;
  assert.equal(await readAuthSession(), null);
  assert.deepEqual(await readAppSession(), { guest: true });
  const cookie = `${GUEST_SESSION_COOKIE}=1; eureka_marketplace_session=${response.cookies.get("eureka_marketplace_session").value}`;
  assert.equal(proxy(request("/api/organization-extensions/1/icon", { headers: { cookie } })).status, 401);
  assert.equal((await profile()).status, 200);
});
