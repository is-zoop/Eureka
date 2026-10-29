import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { copyStandaloneResources, desktopTraceExcludes, standaloneResourceFilter } from "./standalone-resources.mjs";

const require = createRequire(import.meta.url);
const picomatch = require("next/dist/compiled/picomatch");

test("repeated packaging omits previous desktop outputs and caches while retaining server assets", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-test-"));
  try {
    const source = join(root, "standalone");
    const destination = join(root, "resources", "app");
    const included = ["server.js", "package.json", ".next/server/app/page.js", "node_modules/next/package.json", "lib/auth/runtime.mjs"];
    const excluded = ["desktop/resources/app/desktop/src-tauri/target/release/old.exe", "desktop/src-tauri/target/debug/resources/app/.cache/missing.json", ".cache/atlas.json", ".tmp/test.txt", ".git/config", ".next/cache/webpack/data", ".next/dev/server.js", ".next/standalone/server.js"];
    for (const name of [...included, ...excluded]) {
      const file = join(source, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, name);
    }
    copyStandaloneResources(source, destination);
    for (const name of included) assert.equal(readFileSync(join(destination, name), "utf8"), name);
    for (const name of excluded) assert.equal(existsSync(join(destination, name)), false, name);
    assert.equal(existsSync(join(destination, "desktop")), false);

    const second = join(root, "second");
    copyStandaloneResources(destination, second);
    assert.equal(existsSync(join(second, "desktop")), false);
    assert.equal(readFileSync(join(second, "server.js"), "utf8"), "server.js");
    assert.throws(() => copyStandaloneResources(source, join(source, "nested")), /outside/);
    assert.equal(standaloneResourceFilter(source)(root), false);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "eureka-resource-test-")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("Next shared trace exclusions cover generated files in both Windows and normalized paths", () => {
  const root = resolve(".");
  const matches = picomatch(desktopTraceExcludes, { dot: true, contains: true });
  for (const path of ["desktop/resources/app/server.js", "desktop/src-tauri/target/release/eureka.exe", ".cache/atlas.json", ".next/cache/data"]) {
    assert.equal(matches(join(root, path)), true, path);
    assert.equal(matches(join(root, path).replaceAll("\\", "/")), true, path);
  }
  assert.equal(matches(join(root, "node_modules/next/package.json")), false);
  assert.equal(matches(join(root, "lib/auth/runtime.mjs")), false);
});
