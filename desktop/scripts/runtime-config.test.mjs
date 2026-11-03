import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { PUBLIC_RUNTIME_KEYS, publicRuntimeConfig, writeRuntimeEnvironment, withoutSigningSecrets } from "./runtime-config.mjs";
const publicConfig = { EUREKA_AUTH_PROVIDER: "haze-oidc", EUREKA_AUTH_HAZE_ISSUER: "https://identity.example", EUREKA_AUTH_CLIENT_ID: "public-client", EUREKA_AUTH_REDIRECT_URI: "http://127.0.0.1:8080/api/marketplace-auth/callback/haze" };
test("runtime configuration keeps only explicitly allowed public login fields", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-runtime-config-"));
  try {
    const secrets = { EUREKA_AUTH_SESSION_SECRET: "private-session-secret", TAURI_SIGNING_PRIVATE_KEY: "private-updater-key", API_KEY: "private-api-key" };
    const config = publicRuntimeConfig({ ...publicConfig, ...secrets });
    assert.deepEqual(config, publicConfig);
    writeRuntimeEnvironment(root, { ...config, ...secrets });
    const bytes = readFileSync(join(root, ".env.local"), "utf8");
    assert.deepEqual(Object.keys(parseEnv(bytes)).sort(), [...PUBLIC_RUNTIME_KEYS].sort());
    for (const value of Object.values(secrets)) assert.ok(!bytes.includes(value));
    assert.equal(parseEnv(bytes).EUREKA_AUTH_CLIENT_ID, publicConfig.EUREKA_AUTH_CLIENT_ID);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("unsafe or incomplete public configuration fails before packaging", () => {
  assert.throws(() => publicRuntimeConfig({}), /incomplete/);
  assert.throws(() => publicRuntimeConfig({ ...publicConfig, EUREKA_AUTH_HAZE_ISSUER: "http://identity.example" }), /HTTPS/);
  assert.throws(() => publicRuntimeConfig({ ...publicConfig, EUREKA_AUTH_REDIRECT_URI: "https://external.example" }), /callback/);
  assert.throws(() => publicRuntimeConfig({ ...publicConfig, EUREKA_AUTH_CLIENT_ID: "public\nAPI_KEY=secret" }), /invalid/);
  assert.deepEqual(withoutSigningSecrets({ A: "kept", TAURI_SIGNING_PRIVATE_KEY: "hidden", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "hidden", GITHUB_TOKEN: "hidden", GH_TOKEN: "hidden" }), { A: "kept" });
});
