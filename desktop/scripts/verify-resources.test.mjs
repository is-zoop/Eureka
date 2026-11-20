import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { copyStandaloneServerAssets } from "./standalone-resources.mjs";
import { verifyStandaloneResources } from "./verify-resources.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "eureka-startup-test-"));
  return { root, write(name, content) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }, cleanup() { assert.equal(dirname(root), resolve(tmpdir())); assert.ok(root.startsWith(join(tmpdir(), "eureka-startup-test-"))); rmSync(root, { recursive: true, force: true }); } };
}

test("packaging retains server chunks omitted from the standalone trace and rejects mixed builds", () => {
  const f = fixture();
  try {
    f.write("build/BUILD_ID", "same-build"); f.write("app/.next/BUILD_ID", "same-build");
    f.write("build/server/chunks/5573.js", "transitive startup dependency");
    f.write("build/server/instrumentation.js", "instrumentation entry");
    copyStandaloneServerAssets(join(f.root, "build"), join(f.root, "app"));
    assert.equal(readFileSync(join(f.root, "app/.next/server/chunks/5573.js"), "utf8"), "transitive startup dependency");
    f.write("build/BUILD_ID", "different-build");
    assert.throws(() => copyStandaloneServerAssets(join(f.root, "build"), join(f.root, "app")), /different Next build/);
  } finally { f.cleanup(); }
});

test("resource check accepts the bundled startup identity, login page and homepage redirect", async () => {
  const f = fixture();
  try {
    f.write("server.js", `require("node:http").createServer((req, res) => {
      if (req.url === "/api/desktop-startup") {
        res.writeHead(204, { "X-Eureka-Startup-Id": process.env.EUREKA_DESKTOP_STARTUP_ID });
      } else if (req.url !== "/login") {
        res.writeHead(307, { location: "/login" });
      }
      res.end();
    }).listen(Number(process.env.PORT), "127.0.0.1");`);
    await verifyStandaloneResources(f.root, process.execPath, 5000);
  } finally { f.cleanup(); }
});

test("resource check rejects a healthy login page with a mismatched startup identity", async () => {
  const f = fixture();
  try {
    f.write("server.js", `require("node:http").createServer((req, res) => {
      if (req.url === "/api/desktop-startup") res.writeHead(204, { "X-Eureka-Startup-Id": "0".repeat(32) });
      res.end();
    }).listen(Number(process.env.PORT), "127.0.0.1");`);
    await assert.rejects(verifyStandaloneResources(f.root, process.execPath, 5000), /expected startup identity/);
  } finally { f.cleanup(); }
});

test("resource check fails packaging for an HTTP 500 even when the server is listening", async () => {
  const f = fixture();
  try {
    f.write("server.js", 'require("node:http").createServer((_req,res)=>{console.error("missing startup chunk");res.statusCode=500;res.end("Internal Server Error");}).listen(Number(process.env.PORT),"127.0.0.1");');
    await assert.rejects(verifyStandaloneResources(f.root, process.execPath, 5000), /login page returned HTTP 500/);
  } finally { f.cleanup(); }
});
