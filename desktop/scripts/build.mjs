import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutSigningSecrets } from "./runtime-config.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const key = join(desktop, ".signing", "updater.key");
  if (!existsSync(key)) throw new Error("Restore desktop/.signing/updater.key or set TAURI_SIGNING_PRIVATE_KEY before building a signed installer.");
  env.TAURI_SIGNING_PRIVATE_KEY = key;
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}
const steps = [
  { args: [join(desktop, "scripts/prepare-resources.mjs")], env: withoutSigningSecrets(env) },
  { args: [join(desktop, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--bundles", "nsis"], env },
];
for (const step of steps) {
  const result = spawnSync(process.execPath, step.args, { cwd: desktop, env: step.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
