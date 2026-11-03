import { createHash, createPublicKey, verify } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncVersions } from "../../scripts/sync-version.mjs";
import { readPublicRuntimeConfig } from "./runtime-config.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function decodedLines(value) { return Buffer.from(value.trim(), "base64").toString("utf8").trim().split(/\r?\n/); }

// Matches minisign-verify used by Tauri: Ed/ED signatures and their trusted comment.
export function verifyInstaller(bytes, signature, publicKey) {
  const publicLines = decodedLines(publicKey), lines = decodedLines(signature);
  const key = Buffer.from(publicLines[1] ?? "", "base64"), signed = Buffer.from(lines[1] ?? "", "base64"), global = Buffer.from(lines[3] ?? "", "base64");
  if (key.length !== 42 || signed.length !== 74 || global.length !== 64 || !lines[2]?.startsWith("trusted comment: ")) throw new Error("Invalid updater key/signature format.");
  const algorithm = signed.subarray(0, 2).toString("ascii");
  if (!["Ed", "ED"].includes(algorithm) || !["Ed", "ED"].includes(key.subarray(0, 2).toString("ascii")) || !key.subarray(2, 10).equals(signed.subarray(2, 10))) throw new Error("Installer signing key does not match the configured updater public key.");
  const ed25519 = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]), format: "der", type: "spki" });
  const payload = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  if (!verify(null, payload, ed25519, signed.subarray(10)) || !verify(null, Buffer.concat([signed.subarray(10), Buffer.from(lines[2].slice(17))]), ed25519, global)) throw new Error("Installer signature verification failed. Release creation was stopped.");
}

export function releaseMetadata(root = project, env = process.env) {
  syncVersions(root, { check: true });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const repo = pkg.repository.url.match(/^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\.git$/)?.[1];
  if (!repo || env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY.toLowerCase() !== repo.toLowerCase()) throw new Error("Release repository differs from package.json.");
  const tag = `v${pkg.version}`;
  if (env.GITHUB_REF_TYPE === "tag" && env.GITHUB_REF_NAME !== tag) throw new Error("The pushed tag must match package.json version.");
  const notesFile = join(root, "docs/releases", `${tag}.md`);
  if (!existsSync(notesFile)) throw new Error(`Add reviewed release notes at docs/releases/${tag}.md before building.`);
  const config = JSON.parse(readFileSync(join(root, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  if (config.plugins?.updater?.endpoints?.[0] !== `https://github.com/${repo}/releases/latest/download/latest.json`) throw new Error("Updater endpoint differs from the release repository.");
  readPublicRuntimeConfig(root);
  return { version: pkg.version, tag, repo, name: `Eureka_${pkg.version}_x64-setup.exe`, notes: readFileSync(notesFile, "utf8").trim(), publicKey: config.plugins.updater.pubkey };
}

export function prepareReleaseArtifacts(root = project, env = process.env, now = new Date()) {
  const info = releaseMetadata(root, env);
  const source = join(root, "desktop/src-tauri/target/release/bundle/nsis", info.name);
  const bytes = readFileSync(source), signature = readFileSync(`${source}.sig`, "utf8").trim();
  verifyInstaller(bytes, signature, info.publicKey);
  const manifest = { version: info.version, notes: info.notes, pub_date: now.toISOString(), platforms: { "windows-x86_64": { url: `https://github.com/${info.repo}/releases/download/${info.tag}/${info.name}`, signature } } };
  const destination = join(root, "desktop/release");
  mkdirSync(destination, { recursive: true });
  copyFileSync(source, join(destination, info.name));
  writeFileSync(join(destination, `${info.name}.sig`), `${signature}\n`);
  writeFileSync(join(destination, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(destination, "release-notes.md"), info.notes + "\n");
  const filenames = [info.name, `${info.name}.sig`, "latest.json"];
  writeFileSync(join(destination, "SHA256SUMS.txt"), filenames.map(name => `${createHash("sha256").update(readFileSync(join(destination, name))).digest("hex")}  ${name}`).join("\n") + "\n");
  return { ...info, directory: destination, filenames: [...filenames, "SHA256SUMS.txt"] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const { tag, repo } = releaseMetadata(); console.log(`Release metadata verified: ${repo} ${tag}.`);
  } else {
    const { tag } = prepareReleaseArtifacts(); console.log(`Verified signed artifacts and generated desktop/release/latest.json for ${tag}.`);
  }
}
