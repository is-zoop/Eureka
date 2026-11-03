import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { syncVersions } from "../scripts/sync-version.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eureka-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ["package.json", "package-lock.json", "desktop/package.json", "desktop/package-lock.json", "desktop/src-tauri/tauri.conf.json", "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/Cargo.lock"];
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(new URL(`../${path}`, import.meta.url)));
  }
  const read = (path) => readFileSync(join(root, path), "utf8");
  const source = JSON.parse(read("package.json"));
  source.version = "9.8.7";
  writeFileSync(join(root, "package.json"), JSON.stringify(source, null, 2) + "\n");
  return { root, files, read };
}

test("syncs application versions and identity without changing dependencies or installation identity", (t) => {
  const { root, read } = fixture(t);
  const cargo = read("desktop/src-tauri/Cargo.toml");
  const lock = read("desktop/src-tauri/Cargo.lock");
  const npm = JSON.parse(read("package-lock.json"));
  const desktopNpm = JSON.parse(read("desktop/package-lock.json"));
  const tauri = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
  syncVersions(root);
  for (const path of ["package-lock.json", "desktop/package.json", "desktop/package-lock.json", "desktop/src-tauri/tauri.conf.json"]) {
    assert.equal(JSON.parse(read(path)).version, "9.8.7", path);
  }
  const rootLock = JSON.parse(read("package-lock.json"));
  const desktopLock = JSON.parse(read("desktop/package-lock.json"));
  assert.equal(rootLock.packages[""].version, "9.8.7");
  assert.equal(desktopLock.packages[""].version, "9.8.7");
  delete npm.packages[""]; delete rootLock.packages[""];
  delete desktopNpm.packages[""]; delete desktopLock.packages[""];
  assert.deepEqual(rootLock.packages, npm.packages);
  assert.deepEqual(desktopLock.packages, desktopNpm.packages);
  assert.equal(read("desktop/src-tauri/Cargo.toml"), cargo.replace(/(^version = ")[^"]+(")/m, (_, prefix, suffix) => `${prefix}9.8.7${suffix}`));
  assert.equal(read("desktop/src-tauri/Cargo.lock"), lock.replace(/(name = "eureka"\r?\nversion = ")[^"]+(")/, (_, prefix, suffix) => `${prefix}9.8.7${suffix}`));
  const syncedTauri = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
  assert.deepEqual({ ...syncedTauri, version: tauri.version }, tauri);
  const desktop = JSON.parse(read("desktop/package.json"));
  const source = JSON.parse(read("package.json"));
  assert.deepEqual(desktop.repository, source.repository);
  assert.equal(desktop.homepage, source.homepage);
  assert.deepEqual(desktop.bugs, source.bugs);
  assert.deepEqual(syncVersions(root), { version: "9.8.7", changedFiles: [] });
  assert.doesNotThrow(() => syncVersions(root, { check: true }));
});

test("check detects drift without writing any file", (t) => {
  const { root, files, read } = fixture(t);
  const before = files.map(read);
  assert.throws(() => syncVersions(root, { check: true }), /npm run version:sync/);
  assert.deepEqual(files.map(read), before);
});

test("invalid Cargo metadata aborts before any staged JSON changes are written", (t) => {
  const { root, files, read } = fixture(t);
  writeFileSync(join(root, "desktop/src-tauri/Cargo.lock"), read("desktop/src-tauri/Cargo.lock").replace('name = "eureka"', 'name = "missing"'));
  const before = files.map(read);
  assert.throws(() => syncVersions(root), /missing the eureka package/);
  assert.deepEqual(files.map(read), before);
});
