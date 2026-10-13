import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const fixtures = await mkdtemp(path.join(tmpdir(), "eureka-desktop-auth-test-"));
after(() => rm(fixtures, { recursive: true, force: true }));
await writeFile(path.join(fixtures, "config.cjs"), `
exports.AUTH_SESSION_COOKIE = "eureka_marketplace_session";
exports.AUTH_TRANSACTION_COOKIE = "eureka_marketplace_oauth";
exports.MARKETPLACE_PERMISSION = "page.marketplace";
exports.getAuthConfig = () => ({provider:"haze-oidc", issuer:"https://haze.test",clientId:"test-client",
redirectUri:"http://127.0.0.1:8080/api/marketplace-auth/callback/haze",sessionSecret:"a-test-only-secret-that-is-long-enough"});
`);
await writeFile(path.join(fixtures, "provider.cjs"), `
exports.getIdentityProvider = () => ({id:"haze-oidc",
authorizationUrl: ({state,codeChallenge}) => "https://haze.test/oauth?" + new URLSearchParams({state,code_challenge:codeChallenge}),
exchangeCode: async () => ({accessToken:"fake-access",refreshToken:"fake-refresh",expiresIn:3600}),
userInfo: async () => ({subject:"test-user",name:"Test",permissions:[]})});
`);
await writeFile(path.join(fixtures, "headers.cjs"), "exports.cookies = async () => globalThis.__desktopAuthRouteTestCookies;");
await writeFile(path.join(fixtures, "runtime.cjs"), "exports.writeRuntimeHazeSession = () => {}; exports.clearRuntimeHazeSession = () => {};");
await mkdir(path.join(fixtures, "lib/auth"), { recursive: true });
for (const name of ["session", "session-value", "guest", "crypto", "access-token-cache", "desktop-login-store", "types"]) {
  await writeFile(path.join(fixtures, `lib/auth/${name}.ts`), await readFile(`lib/auth/${name}.ts`));
}
for (const [name, stub] of [["config", "config"], ["provider", "provider"], ["runtime-session", "runtime"]]) {
  await writeFile(path.join(fixtures, `lib/auth/${name}.ts`), await readFile(path.join(fixtures, `${stub}.cjs`)));
}
const jiti = createJiti(import.meta.url, { alias: {
  "@": fixtures,
  "next/server": import.meta.resolve("next/server.js"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js"),
  "next/headers": path.join(fixtures, "headers.cjs"),
} });
const { NextRequest } = await jiti.import("next/server");
const { POST } = await jiti.import("./route.ts");
const { GET: startOAuth } = await jiti.import("../start/route.ts");
const { GET: callback } = await jiti.import("../callback/haze/route.ts");
const { readAuthSessionValue } = await jiti.import("@/lib/auth/session-value");
const { readTransaction } = await jiti.import("@/lib/auth/session");

const post = (body) => POST(new NextRequest("http://127.0.0.1:8080/api/marketplace-auth/desktop", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const oauthStart = (url) => startOAuth(new NextRequest(url, { headers: { host: new URL(url).host } }));

async function browserFlow(pending) {
  const start = await oauthStart(pending.browserUrl);
  globalThis.__desktopAuthRouteTestCookies = start.cookies;
  const tx = readTransaction(start.cookies);
  assert.ok(tx.verifier);
  assert.equal(new URL(start.headers.get("location")).searchParams.get("state"), tx.state);
  return tx;
}

test("browser authorization returns no session cookie; only the initiating desktop receives it", async () => {
  const response = await post({ action: "start", returnTo: "/?session=1" });
  assert.equal(response.status, 200);
  const pending = await response.json();
  assert.equal(pending.browserUrl.includes(pending.claimToken), false);
  const tx = await browserFlow(pending);
  const authorized = await callback(new NextRequest(`http://127.0.0.1:8080/api/marketplace-auth/callback/haze?code=fake-code&state=${tx.state}`));
  assert.equal(new URL(authorized.headers.get("location")).search, "?desktop=success");
  assert.equal(authorized.cookies.get("eureka_marketplace_session"), undefined);
  const wrong = await post({ action: "poll", requestId: pending.requestId, claimToken: "wrong-token" });
  assert.equal(wrong.status, 410);
  const claimed = await post({ action: "poll", requestId: pending.requestId, claimToken: pending.claimToken });
  assert.deepEqual(await claimed.json(), { status: "complete", returnTo: "/?session=1" });
  const cookie = claimed.cookies.get("eureka_marketplace_session");
  assert.equal(cookie.httpOnly, true);
  assert.equal(readAuthSessionValue(cookie.value).principal.subject, "test-user");
  assert.equal(claimed.headers.get("Cache-Control"), "no-store");
  assert.equal((await post({ action: "poll", requestId: pending.requestId, claimToken: pending.claimToken })).status, 410);
});

test("desktop state mismatch never completes login and provider denial is delivered to the desktop", async () => {
  const pending = await (await post({ action: "start", returnTo: "//outside.test" })).json();
  const tx = await browserFlow(pending);
  await callback(new NextRequest("http://127.0.0.1:8080/api/marketplace-auth/callback/haze?code=fake-code&state=wrong"));
  assert.deepEqual(await (await post({ action: "poll", requestId: pending.requestId, claimToken: pending.claimToken })).json(), { status: "pending" });
  await callback(new NextRequest(`http://127.0.0.1:8080/api/marketplace-auth/callback/haze?error=access_denied&state=${tx.state}`));
  const denied = await post({ action: "poll", requestId: pending.requestId, claimToken: pending.claimToken });
  assert.deepEqual(await denied.json(), { status: "failed", error: "access_denied" });
  assert.equal(denied.cookies.get("eureka_marketplace_session"), undefined);
});

test("web login still issues its normal browser cookie and canonical starts preserve desktop pairing", async () => {
  const start = await oauthStart("http://127.0.0.1:8080/api/marketplace-auth/start?returnTo=%2F%3Fsession%3Dweb");
  globalThis.__desktopAuthRouteTestCookies = start.cookies;
  const tx = readTransaction(start.cookies);
  const response = await callback(new NextRequest(`http://127.0.0.1:8080/api/marketplace-auth/callback/haze?code=fake-code&state=${tx.state}`));
  assert.equal(new URL(response.headers.get("location")).search, "?session=web");
  assert.ok(readAuthSessionValue(response.cookies.get("eureka_marketplace_session").value));
  const pending = await (await post({ action: "start" })).json();
  const canonical = await oauthStart(`http://localhost:8080/api/marketplace-auth/start?desktopRequest=${pending.requestId}`);
  const destination = new URL(canonical.headers.get("location"));
  assert.equal(destination.origin, "http://127.0.0.1:8080");
  assert.equal(destination.searchParams.get("desktopRequest"), pending.requestId);
});
