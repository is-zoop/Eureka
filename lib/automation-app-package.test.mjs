import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { fixtureZip, pluginFiles } from "./haze-plugin-fixture.mjs";
const jiti = createJiti(import.meta.url);
const { automationExampleFiles } = await jiti.import("./automation-app-example.ts");
const { inspectAutomationFiles, parseAutomationAppArchive, writeAutomationAppZip } = await jiti.import("./automation-app-package.ts");
const { parsePluginArchive } = await jiti.import("./haze-plugin-package.ts");
function editJson(files, name, edit) { const value = JSON.parse(files.get(name).toString()); edit(value); files.set(name, Buffer.from(JSON.stringify(value))); }

test("automation package round-trips without executing entry code and supports variable node counts", () => {
  for (const [version, nodes] of [["1.0.0", 2], ["1.1.0", 3]]) {
    const files = automationExampleFiles(version);
    files.set("scripts/main.mjs", Buffer.from("globalThis.__a02EntryExecuted = true; export default async function(){}"));
    const source = inspectAutomationFiles(files), copy = parseAutomationAppArchive(writeAutomationAppZip(files));
    assert.equal(copy.digest, source.digest);
    assert.equal(copy.workflow.nodes.length, nodes);
    assert.equal(copy.manifest.version, version);
    assert.equal(globalThis.__a02EntryExecuted, undefined);
    assert.deepEqual([...copy.files.keys()].sort(), [...files.keys()].sort());
  }
});
test("publication cannot include user folders, runtime state, credentials, install scripts or dependencies", () => {
  for (const path of ["config.json", "app-data/user/config.json", "logs/run.json", "evidence/response.json", "artifacts/result.csv", "auth.json", ".env", "node_modules/pkg/index.js", "../outside", "C:/outside", "scripts/CON.js"]) {
    const files = automationExampleFiles(); files.set(path, Buffer.from("private"));
    editJson(files, "plugin.json", value => value.extensions["com.eureka"].automation.files.push(path));
    assert.throws(() => inspectAutomationFiles(files));
  }
  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    const files = automationExampleFiles(); editJson(files, "package.json", pkg => { pkg[key] = { install: "something" }; });
    assert.throws(() => inspectAutomationFiles(files));
  }
  const unlisted = automationExampleFiles(); unlisted.set("assets/extra.txt", Buffer.from("unpublished"));
  assert.throws(() => inspectAutomationFiles(unlisted), /发布清单/);
});
test("ZIP escapes, symbolic links, duplicates and stale declarations are rejected", () => {
  const files = Object.fromEntries(automationExampleFiles());
  assert.equal(parseAutomationAppArchive(fixtureZip(files, { prefix: "example/" })).manifest.name, "file-list-package-example");
  assert.throws(() => parseAutomationAppArchive(fixtureZip(files, { prefix: "../" })));
  assert.throws(() => parseAutomationAppArchive(fixtureZip(files, { symlink: "scripts/main.mjs" })));
  assert.throws(() => parseAutomationAppArchive(fixtureZip([...Object.entries(files), ["PLUGIN.JSON", "duplicate"]])));
  const invalid = automationExampleFiles(); editJson(invalid, "workflow.json", wf => { wf.edges[0].to = "missing"; });
  assert.throws(() => inspectAutomationFiles(invalid), /不存在/);
});
test("existing Skill and HTTP MCP packages keep their existing parser and installation contract", () => {
  const legacy = parsePluginArchive(fixtureZip(pluginFiles()), "2.1.0");
  assert.deepEqual(legacy.manifest.skillDirectories, ["skills"]);
  assert.equal(legacy.manifest.servers[0].name, "atlas");
  assert.throws(() => parseAutomationAppArchive(fixtureZip(pluginFiles())));
});
