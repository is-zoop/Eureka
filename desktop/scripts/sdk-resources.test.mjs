import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { copySdkRuntimeResources } from "./sdk-resources.mjs";

test("SDK staging retains new transitive assets and nested versions without copying development dependencies", (t) => {
  const root = mkdtempSync(join(tmpdir(), "eureka-sdk-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function pkg(path, manifest, files = {}) {
    const directory = join(root, "node_modules", path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    for (const [path, value] of Object.entries(files)) {
      const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value);
    }
  }
  pkg("@earendil-works/pi-coding-agent", { dependencies: { "@earendil-works/pi-mcp": "1", shared: "1" }, devDependencies: { "development-only": "1" }, optionalDependencies: { "absent-platform": "1" } });
  pkg("@earendil-works/pi-mcp", { exports: { ".": "./dist/index.js" }, dependencies: { shared: "2" } }, { "dist/index.js": "export {}", "dist/catalog.json": "{}", "dist/runtime.wasm": "fixture", "dist/index.js.map": "{}" });
  pkg("shared", { version: "1" });
  pkg("@earendil-works/pi-mcp/node_modules/shared", { version: "2" });
  pkg("development-only", { version: "1" });
  const app = join(root, "staged");
  const copied = copySdkRuntimeResources(root, app, ["@earendil-works/pi-coding-agent"]);
  assert.equal(copied.length, 4);
  const mcp = join(app, "node_modules", "@earendil-works/pi-mcp");
  assert.equal(readFileSync(join(mcp, "dist/runtime.wasm"), "utf8"), "fixture");
  assert.equal(existsSync(join(mcp, "dist/catalog.json")), true);
  assert.equal(existsSync(join(mcp, "dist/index.js.map")), false);
  assert.equal(existsSync(join(app, "node_modules/development-only")), false);
  assert.equal(JSON.parse(readFileSync(join(mcp, "node_modules/shared/package.json"))).version, "2");
  assert.throws(() => copySdkRuntimeResources(root, app, ["missing-required"]), /Missing SDK runtime dependency/);
});
