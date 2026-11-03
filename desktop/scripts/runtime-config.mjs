import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const PUBLIC_RUNTIME_KEYS = ["EUREKA_AUTH_PROVIDER", "EUREKA_AUTH_HAZE_ISSUER", "EUREKA_AUTH_CLIENT_ID", "EUREKA_AUTH_REDIRECT_URI"];
export function publicRuntimeConfig(...sources) {
  const config = {};
  for (const key of PUBLIC_RUNTIME_KEYS) for (const source of sources) {
    if (typeof source?.[key] === "string" && source[key].trim()) { config[key] = source[key].trim(); break; }
  }
  config.EUREKA_AUTH_PROVIDER ??= "haze-oidc";
  if (PUBLIC_RUNTIME_KEYS.some(key => !config[key] || /[\r\n\0]/.test(config[key]))) throw new Error("Public desktop login configuration is incomplete or invalid.");
  const issuer = new URL(config.EUREKA_AUTH_HAZE_ISSUER), redirect = new URL(config.EUREKA_AUTH_REDIRECT_URI);
  if (config.EUREKA_AUTH_PROVIDER !== "haze-oidc" || issuer.protocol !== "https:" || issuer.username || issuer.password) throw new Error("Desktop login requires the HTTPS Haze provider without embedded credentials.");
  if (redirect.origin !== "http://127.0.0.1:8080" || redirect.username || redirect.password) throw new Error("Desktop OAuth callback must use http://127.0.0.1:8080.");
  return config;
}
export function readPublicRuntimeConfig(root, env = process.env) {
  const local = join(root, ".env.local"), defaults = join(root, "desktop/runtime-config.json");
  return publicRuntimeConfig(env, existsSync(local) ? parseEnv(readFileSync(local, "utf8")) : {}, existsSync(defaults) ? JSON.parse(readFileSync(defaults, "utf8")) : {});
}
export function writeRuntimeEnvironment(directory, config) {
  const safe = publicRuntimeConfig(config);
  writeFileSync(join(directory, ".env.local"), PUBLIC_RUNTIME_KEYS.map(key => `${key}=${JSON.stringify(safe[key])}`).join("\n") + "\n");
}
export function withoutSigningSecrets(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(TAURI_SIGNING_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  writeFileSync(join(root, "desktop/runtime-config.json"), JSON.stringify(readPublicRuntimeConfig(root), null, 2) + "\n");
  console.log("Saved four public desktop login settings. No private environment values were copied.");
}
