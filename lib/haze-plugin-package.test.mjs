import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { parsePluginArchive, parsePluginComposer, pluginServerUrl, readPluginZip } from "./haze-plugin-package.ts";
import { fixtureZip, pluginFiles } from "./haze-plugin-fixture.mjs";

test("Eureka archive preserves both skills and shared references", () => {
  const parsed = parsePluginArchive(fixtureZip(), "2.1.0");
  assert.equal(parsed.manifest.name, "atlas-ask");
  assert.equal(parsed.files.has("references/current-rules.md"), true);
  assert.deepEqual(parsed.manifest.skillDirectories, ["skills"]);
  assert.deepEqual(parsed.manifest.servers, [{ name: "atlas", url: "https://atlas.example/api/mcp", auth: "haze-personal-credential" }]);
  assert.equal(parsed.files.size, 7);
});
test("rejects version mismatches, foreign host packages and unsupported execution", () => {
  assert.throws(() => parsePluginArchive(fixtureZip(), "2.2.0"), /版本/);
  for (const change of [
    (files) => { const config = JSON.parse(files["plugin.json"]); config.extensions = { "com.openai": {} }; files["plugin.json"] = JSON.stringify(config); },
    (files) => { const config = JSON.parse(files["package.json"]); config.pi.extensions = ["./run.ts"]; files["package.json"] = JSON.stringify(config); },
    (files) => { const config = JSON.parse(files["mcp.json"]); config.mcpServers.atlas.type = "stdio"; files["mcp.json"] = JSON.stringify(config); },
    (files) => { const config = JSON.parse(files["mcp.json"]); config.mcpServers.atlas.extensions = { "com.openai": { auth: {} } }; files["mcp.json"] = JSON.stringify(config); },
    (files) => { const config = JSON.parse(files["plugin.json"]); config.extensions["com.eureka"].auth.atlas.provider = "other"; files["plugin.json"] = JSON.stringify(config); },
    (files) => { const config = JSON.parse(files["package.json"]); config.pi.skills = ["./missing"]; files["package.json"] = JSON.stringify(config); },
  ]) { const files = pluginFiles(); change(files); assert.throws(() => parsePluginArchive(fixtureZip(files), "2.1.0")); }
});
test("archive rejects Windows escapes, links, duplicate names and corrupt content", () => {
  for (const path of ["../outside", "C:/outside", "\\server\\file", "CON.txt", "a./file", "file:stream", "a//b", "a/../b"]) assert.throws(() => readPluginZip(fixtureZip({ [path]: "bad" })));
  assert.throws(() => readPluginZip(fixtureZip([["A", "one"], ["a", "two"]])), /重复/);
  assert.throws(() => readPluginZip(fixtureZip({ link: "target" }, { symlink: "link" })), /链接/);
  const damaged = fixtureZip(); damaged[60] ^= 1;
  assert.throws(() => readPluginZip(damaged));
  assert.throws(() => readPluginZip(Buffer.from("not a zip")));
  assert.throws(() => readPluginZip(fixtureZip({ file: "x", "file/nested": "x" })), /冲突/);
});
test("deflate output is bounded by the declared uncompressed size", () => {
  const zip = fixtureZip({ bomb: "tiny" }, { prefix: "" });
  const compressed = deflateRawSync(Buffer.alloc(4096));
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const nameSize = zip.readUInt16LE(26), start = 30 + nameSize;
  const header = Buffer.from(zip.subarray(0, start)); header.writeUInt16LE(8, 8); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(1, 22);
  const index = Buffer.from(zip.subarray(central)); index.writeUInt16LE(8, 10); index.writeUInt32LE(compressed.length, 20); index.writeUInt32LE(1, 24); index.writeUInt32LE(start + compressed.length, index.length - 6);
  assert.throws(() => readPluginZip(Buffer.concat([header, compressed, index])));
});
test("loopback HTTP plugins are accepted in production and development without a package override", () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const mode of ["production", "development"]) {
      process.env.NODE_ENV = mode;
      for (const url of ["http://localhost:3000/api/mcp", "http://127.0.0.1:3000/api/mcp", "http://[::1]:3000/api/mcp"]) {
        assert.equal(pluginServerUrl(url), url);
        assert.equal(parsePluginArchive(fixtureZip(pluginFiles({ url })), "2.1.0").manifest.servers[0].url, url);
      }
      for (const url of ["http://localhost.example/api/mcp", "http://127.0.0.1.example/api/mcp", "http://192.168.1.10/api/mcp", "http://0.0.0.0:3000/api/mcp", "http://user:secret@localhost:3000/api/mcp", "http://localhost:3000/api/mcp?token=secret", "http://localhost:3000/api/mcp#secret"]) assert.throws(() => pluginServerUrl(url));
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
test("non-loopback endpoints must be credential-free HTTPS", () => {
  assert.equal(pluginServerUrl("https://atlas.example/api/mcp"), "https://atlas.example/api/mcp");
  for (const url of ["http://untrusted.example/mcp", "https://user:password@atlas.example/mcp", "https://atlas.example/mcp?token=secret", "file:///etc/passwd"]) assert.throws(() => pluginServerUrl(url));
});


test("host clarification capability is opt-in, boolean and preserved by package validation", () => {
  assert.equal(parsePluginArchive(fixtureZip(), "2.1.0").manifest.capabilities, undefined);
  assert.equal(parsePluginArchive(fixtureZip(pluginFiles({ requestUserInput: true })), "2.1.0").manifest.capabilities.requestUserInput, true);
  assert.equal(parsePluginArchive(fixtureZip(pluginFiles({ requestUserInput: false })), "2.1.0").manifest.capabilities.requestUserInput, false);
  for (const value of ["true", 1, null, {}]) assert.throws(() => parsePluginArchive(fixtureZip(pluginFiles({ requestUserInput: value })), "2.1.0"), /布尔/);
});

test("composer defaults to once and preserves only supported selection modes", () => {
  assert.equal(parsePluginComposer(undefined).selectionMode, "once");
  for (const selectionMode of ["once", "persistent"]) assert.equal(parsePluginArchive(fixtureZip(pluginFiles({ composer: { selectionMode } })), "2.1.0").manifest.composer.selectionMode, selectionMode);
  for (const composer of [null, [], true, {}, { selectionMode: true }, { selectionMode: "always" }, { selectionMode: "persistent", hook: "run.js" }]) assert.throws(() => parsePluginArchive(fixtureZip(pluginFiles({ composer })), "2.1.0"));
});
