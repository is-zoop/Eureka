import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { copyMissingStandaloneDependencies, copyStandaloneResources, desktopTraceExcludes, standaloneResourceFilter, isRuntimeAsset } from "./standalone-resources.mjs";

const require = createRequire(import.meta.url);
const picomatch = require("next/dist/compiled/picomatch");

test("repeated packaging omits previous desktop outputs and caches while retaining server assets", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-test-"));
  try {
    const source = join(root, "standalone");
    const destination = join(root, "resources", "app");
    const included = ["server.js", "package.json", ".next/server/app/page.js", "node_modules/next/package.json", "lib/auth/runtime.mjs"];
    const excluded = ["desktop/resources/app/desktop/src-tauri/target/release/old.exe", "desktop/src-tauri/target/debug/resources/app/.cache/missing.json", ".env", ".env.local", ".env.production", "desktop/.signing/updater.key", ".signing/key", ".cache/atlas.json", ".tmp/test.txt", ".git/config", ".next/cache/webpack/data", ".next/dev/server.js", ".next/standalone/server.js"];
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

test("runtime packaging omits source maps while retaining executable and TypeScript resources", () => {
  for (const name of ["operation.d.ts.map", "sdk.js.map", "sdk.mjs.map", "sdk.cjs.map", "style.css.map", "package.tsbuildinfo"]) assert.equal(isRuntimeAsset(name), false, name);
  for (const name of ["operation.d.ts", "sdk.js", "extension.ts", "model.json", "node.exe"]) assert.equal(isRuntimeAsset(name), true, name);
});

test("missing traced production dependencies are copied into the packaged app", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-deps-"));
  try {
    const writePkg = (dir, name, deps = {}, extraFiles = {}) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: deps }));
      writeFileSync(join(dir, "index.js"), "module.exports = '" + name + "';");
      for (const [file, contents] of Object.entries(extraFiles)) writeFileSync(join(dir, file), contents);
    };
    writePkg(join(root, "node_modules", "is-generator-function"), "is-generator-function", { "generator-function": "2.0.1" });
    writePkg(join(root, "node_modules", "generator-function"), "generator-function", {}, { "require.mjs": "export default function() {}" });
    writePkg(join(root, "node_modules", "only-dev"), "only-dev");
    writePkg(join(root, "app", "node_modules", "is-generator-function"), "is-generator-function", { "generator-function": "2.0.1" });
    const copied = copyMissingStandaloneDependencies(root, join(root, "app"));
    assert.deepEqual(copied, ["generator-function"]);
    assert.equal(readFileSync(join(root, "app", "node_modules", "generator-function", "require.mjs"), "utf8"), "export default function() {}");
    assert.equal(existsSync(join(root, "app", "node_modules", "only-dev")), false);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "eureka-resource-deps-")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit runtime seeds are copied even when no packaged parent lists them", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-seeds-"));
  try {
    mkdirSync(join(root, "node_modules", "generator-function"), { recursive: true });
    mkdirSync(join(root, "app", "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules", "generator-function", "package.json"), JSON.stringify({ name: "generator-function", version: "2.0.1" }));
    writeFileSync(join(root, "node_modules", "generator-function", "require.mjs"), "export default function() {}");
    const copied = copyMissingStandaloneDependencies(root, join(root, "app"), ["generator-function"]);
    assert.deepEqual(copied, ["generator-function"]);
    assert.equal(readFileSync(join(root, "app", "node_modules", "generator-function", "require.mjs"), "utf8"), "export default function() {}");
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "eureka-resource-seeds-")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit runtime seeds replace an incomplete traced package including require.mjs", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-incomplete-"));
  try {
    mkdirSync(join(root, "node_modules", "generator-function"), { recursive: true });
    mkdirSync(join(root, "app", "node_modules", "generator-function"), { recursive: true });
    writeFileSync(join(root, "node_modules", "generator-function", "package.json"), JSON.stringify({
      name: "generator-function",
      version: "2.0.1",
      exports: { ".": { "module-sync": "./require.mjs", default: "./index.js" } },
    }));
    writeFileSync(join(root, "node_modules", "generator-function", "require.mjs"), "export default function() {}");
    writeFileSync(join(root, "node_modules", "generator-function", "index.js"), "module.exports = 1;");
    writeFileSync(join(root, "app", "package.json"), JSON.stringify({ name: "app" }));
    writeFileSync(join(root, "app", "node_modules", "generator-function", "package.json"), JSON.stringify({
      name: "generator-function",
      version: "2.0.1",
      exports: { ".": { "module-sync": "./require.mjs", default: "./index.js" } },
    }));
    writeFileSync(join(root, "app", "node_modules", "generator-function", "index.js"), "module.exports = 1;");
    const copied = copyMissingStandaloneDependencies(root, join(root, "app"), ["generator-function"]);
    assert.deepEqual(copied, ["generator-function"]);
    assert.equal(readFileSync(join(root, "app", "node_modules", "generator-function", "require.mjs"), "utf8"), "export default function() {}");
    const require = createRequire(join(root, "app", "package.json"));
    assert.equal(require.resolve("generator-function"), join(root, "app", "node_modules", "generator-function", "require.mjs"));
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "eureka-resource-incomplete-")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("incomplete module-sync packages are refreshed even when they are not seeded", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-resource-async-"));
  try {
    const writePkg = (dir, files) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "async-function",
        version: "1.0.0",
        exports: { ".": { "module-sync": "./require.mjs", default: "./index.js" } },
      }));
      for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    };
    writePkg(join(root, "node_modules", "async-function"), { "require.mjs": "export default function() {}", "index.js": "module.exports = 1;" });
    writePkg(join(root, "app", "node_modules", "async-function"), { "index.js": "module.exports = 1;" });
    writeFileSync(join(root, "app", "package.json"), JSON.stringify({ name: "app" }));
    const copied = copyMissingStandaloneDependencies(root, join(root, "app"), []);
    assert.deepEqual(copied, ["async-function"]);
    assert.equal(readFileSync(join(root, "app", "node_modules", "async-function", "require.mjs"), "utf8"), "export default function() {}");
    const require = createRequire(join(root, "app", "package.json"));
    assert.equal(require.resolve("async-function"), join(root, "app", "node_modules", "async-function", "require.mjs"));
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), "eureka-resource-async-")));
    rmSync(root, { recursive: true, force: true });
  }
});
