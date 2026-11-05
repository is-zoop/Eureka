import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { prepareReleaseArtifacts, releaseMetadata, verifyInstaller } from "./release-artifacts.mjs";

function signedPayload(bytes, prehashed = true) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519"), id = randomBytes(8);
  const rawKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const signature = sign(null, prehashed ? createHash("blake2b512").update(bytes).digest() : bytes, privateKey);
  const comment = "timestamp:1\tfile:fixture.exe\tprehashed";
  const rawSignature = Buffer.concat([Buffer.from(prehashed ? "ED" : "Ed"), id, signature]);
  return {
    key: Buffer.from(`untrusted comment: test public key\n${Buffer.concat([Buffer.from("Ed"), id, rawKey]).toString("base64")}\n`).toString("base64"),
    signature: Buffer.from(`untrusted comment: test signature\n${rawSignature.toString("base64")}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString("base64")}\n`).toString("base64"),
  };
}
test("installer verification accepts minisign modes and refuses altered bytes or mismatched keys", () => {
  const payload = Buffer.from("signed installer");
  for (const prehashed of [true, false]) {
    const signed = signedPayload(payload, prehashed);
    assert.doesNotThrow(() => verifyInstaller(payload, signed.signature, signed.key));
    assert.throws(() => verifyInstaller(Buffer.from("altered"), signed.signature, signed.key), /verification failed/);
    assert.throws(() => verifyInstaller(payload, signed.signature, signedPayload(payload).key), /does not match/);
    assert.throws(() => verifyInstaller(payload, "invalid", signed.key), /Invalid/);
  }
});
test("release generation checks tag identity and emits a matching manifest and checksums", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-release-artifacts-"));
  const put = (path, contents) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents); };
  const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const tag = `v${version}`;
  try {
    for (const file of ["package.json", "package-lock.json", "desktop/package.json", "desktop/package-lock.json", "desktop/src-tauri/tauri.conf.json", "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/Cargo.lock", "desktop/runtime-config.json", `docs/releases/${tag}.md`]) put(file, readFileSync(new URL(`../../${file}`, import.meta.url)));
    const config = JSON.parse(readFileSync(join(root, "desktop/src-tauri/tauri.conf.json"), "utf8"));
    const payload = Buffer.from("MZ test executable"), signed = signedPayload(payload);
    config.plugins.updater.pubkey = signed.key;
    put("desktop/src-tauri/tauri.conf.json", JSON.stringify(config, null, 2) + "\n");
    const name = `Eureka_${version}_x64-setup.exe`;
    put(`desktop/src-tauri/target/release/bundle/nsis/${name}`, payload);
    put(`desktop/src-tauri/target/release/bundle/nsis/${name}.sig`, signed.signature);
    assert.throws(() => releaseMetadata(root, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: `${tag}-mismatch` }), /pushed tag/);
    assert.throws(() => releaseMetadata(root, { GITHUB_REPOSITORY: "other/repo" }), /repository differs/);
    const output = prepareReleaseArtifacts(root, {}, new Date("2026-11-03T00:00:00Z"));
    const manifest = JSON.parse(readFileSync(join(output.directory, "latest.json"), "utf8"));
    assert.equal(manifest.version, version);
    assert.equal(manifest.platforms["windows-x86_64"].url, `https://github.com/is-zoop/Eureka/releases/download/${tag}/${name}`);
    assert.equal(manifest.platforms["windows-x86_64"].signature, signed.signature);
    assert.equal(manifest.pub_date, "2026-11-03T00:00:00.000Z");
    assert.match(readFileSync(join(output.directory, "SHA256SUMS.txt"), "utf8"), new RegExp(createHash("sha256").update(payload).digest("hex")));
    put(`desktop/src-tauri/target/release/bundle/nsis/${name}`, "tampered");
    assert.throws(() => prepareReleaseArtifacts(root, {}), /verification failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
