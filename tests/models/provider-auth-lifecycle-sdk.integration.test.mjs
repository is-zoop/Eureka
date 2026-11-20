import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { collectProviderListingInputs } = await jiti.import("../../server/models/provider-listing-runtime.ts");
const { buildApiKeyProviderList, buildOAuthProviderList } = await jiti.import("../../server/models/provider-listing.ts");

test("SDK auth lifecycle keeps one credential across login, refresh, key switching and logout", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "eureka-auth-lifecycle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, "{}");
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false });
  let refreshes = 0;
  runtime.registerNativeProvider({
    id: "auth-fixture", name: "Fixture", getModels: () => [],
    auth: {
      apiKey: { name: "Fixture key", login: async (interaction) => ({ type: "api_key", key: await interaction.prompt({ type: "text", message: "Key" }) }), resolve: async ({ credential }) => credential ? { auth: { apiKey: credential.key }, source: "stored credential" } : undefined },
      oauth: { name: "Fixture OAuth", login: async (interaction, options) => {
        assert.equal(options.getDeviceId(), "fixture-device");
        interaction.notify({ type: "device_code", userCode: "FIXTURE", verificationUri: "https://unused.invalid" });
        return { type: "oauth", access: "expired-fixture", refresh: "fixture-refresh", expires: 1 };
      }, refresh: async (credential) => { refreshes++; assert.equal(credential.refresh, "fixture-refresh"); return { ...credential, access: "refreshed-fixture", refresh: "rotated-fixture", expires: Date.now() + 3600000 }; },
      toAuth: async (credential) => ({ apiKey: credential.access, baseUrl: "https://credential-endpoint.invalid/v1", headers: { "x-fixture": "oauth" } }) },
    },
    stream: () => { throw new Error("Not called"); }, streamSimple: () => { throw new Error("Not called"); },
  });
  const events = [];
  await runtime.login("auth-fixture", "oauth", { prompt: async () => "fixture-key", notify: (event) => events.push(event) }, { getDeviceId: () => "fixture-device" });
  assert.equal(events[0].type, "device_code");
  const resolved = await runtime.getAuth("auth-fixture");
  assert.equal(refreshes, 1);
  assert.equal(resolved.auth.apiKey, "refreshed-fixture");
  assert.equal(resolved.auth.baseUrl, "https://credential-endpoint.invalid/v1");
  const stored = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(stored["auth-fixture"].refresh, "rotated-fixture");
  let inputs = await collectProviderListingInputs(runtime);
  assert.equal(buildOAuthProviderList(inputs).filter((provider) => provider.id === "auth-fixture").length, 1);
  assert.equal(buildApiKeyProviderList(inputs).find((provider) => provider.id === "auth-fixture").configured, false);
  await runtime.login("auth-fixture", "api_key", { prompt: async () => "fixture-key", notify: () => {} });
  assert.equal((await runtime.getAuth("auth-fixture")).auth.apiKey, "fixture-key");
  assert.equal(JSON.parse(await readFile(authPath, "utf8"))["auth-fixture"].type, "api_key");
  inputs = await collectProviderListingInputs(runtime);
  assert.equal(buildApiKeyProviderList(inputs).filter((provider) => provider.id === "auth-fixture").length, 1);
  assert.equal(buildOAuthProviderList(inputs).find((provider) => provider.id === "auth-fixture").loggedIn, false);
  await runtime.logout("auth-fixture");
  assert.equal((await runtime.listCredentials()).length, 0);
});
