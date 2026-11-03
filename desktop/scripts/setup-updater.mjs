import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const key = join(desktop, ".signing", "updater.key");
const publicKey = `${key}.pub`;
const configPath = join(desktop, "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const pkg = JSON.parse(readFileSync(join(desktop, "..", "package.json"), "utf8"));
const repository = new URL(pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""));
if (repository.protocol !== "https:" || repository.hostname !== "github.com") throw new Error("The updater requires an HTTPS GitHub release repository.");
if (!existsSync(key) || !existsSync(publicKey)) {
  if (existsSync(key) || existsSync(publicKey) || config.plugins?.updater?.pubkey) {
    throw new Error("An updater key is already configured or partially present. Restore the original key pair; automatic key rotation is refused.");
  }
  mkdirSync(dirname(key), { recursive: true });
  // Capture CLI output: never put private key material in logs or chat.
  const result = spawnSync(process.execPath, [join(desktop, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "generate", "--ci", "--write-keys", key], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("Updater key generation failed. Check the local Tauri CLI installation.");
}
const pubkey = readFileSync(publicKey, "utf8").trim();
if (config.plugins?.updater?.pubkey && config.plugins.updater.pubkey !== pubkey) {
  throw new Error("The configured updater public key differs from the local key pair. Restore the matching keys.");
}
config.bundle.createUpdaterArtifacts = true;
config.plugins ??= {};
config.plugins.updater = {
  pubkey,
  endpoints: [`${repository.origin}${repository.pathname}/releases/latest/download/latest.json`],
  windows: { installMode: "passive" },
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("Updater configured. Back up desktop/.signing/updater.key privately; it is not password-encrypted and must never be distributed.");
