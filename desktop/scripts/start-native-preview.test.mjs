import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("native preview detects missing binaries and changed Rust, embedded JS and configuration without starting or compiling", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "eureka-native-preview-"));
  try {
    const scripts = join(root, "desktop", "scripts"), native = join(root, "desktop", "src-tauri");
    await mkdir(scripts, { recursive: true });
    await mkdir(join(native, "src"), { recursive: true });
    await mkdir(join(native, "capabilities"), { recursive: true });
    await mkdir(join(native, "target", "debug"), { recursive: true });
    const launcher = join(scripts, "start-native-preview.ps1"), executable = join(native, "target", "debug", "eureka.exe");
    await copyFile(new URL("./start-native-preview.ps1", import.meta.url), launcher);
    const inputs = [join(native, "src", "main.rs"), join(native, "src", "app-browser.js"), join(native, "Cargo.lock"), join(native, "tauri.dev.conf.json"), join(native, "capabilities", "default.json")];
    const before = new Date(Date.now() - 120_000), built = new Date(Date.now() - 60_000), changed = new Date();
    for (const file of inputs) {
      await writeFile(file, "fixture");
      await utimes(file, before, before);
    }
    function check() {
      const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher, "-CheckOnly"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout.trim());
    }
    assert.equal(check().needsBuild, true);
    await writeFile(executable, "not an executable; CheckOnly must never start it");
    await utimes(executable, built, built);
    assert.equal(check().needsBuild, false);
    for (const file of inputs) {
      await utimes(file, changed, changed);
      const status = check();
      assert.equal(status.needsBuild, true, file);
      assert.equal(status.latestSource, file);
      await utimes(file, before, before);
    }
    assert.equal(check().needsBuild, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
