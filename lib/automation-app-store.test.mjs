import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { automationExampleFiles } = await jiti.import("./automation-app-example.ts");
const { inspectAutomationFiles, parseAutomationAppArchive } = await jiti.import("./automation-app-package.ts");
const owner = "a".repeat(64), other = "b".repeat(64);
async function withStore(fn) {
  const base = await mkdtemp(join(tmpdir(), "eureka-a02-"));
  try { await fn(new AutomationAppStore(base, owner, () => {}), base); }
  finally { await rm(base, { recursive: true, force: true }); }
}
test("updates retain private data, only the latest version is usable, and code remains immutable", async () => withStore(async store => {
  const one = inspectAutomationFiles(automationExampleFiles()), two = inspectAutomationFiles(automationExampleFiles("1.1.0"));
  let install = await store.install(one, 0); const id = install.id, config = join(store.dataDirectory(id), "config.json");
  const privateConfig = JSON.stringify({ schemaVersion: 1, values: { longId: "1008819990098", zero: 0, enabled: false, empty: null }, sentinel: "private-configuration" });
  await writeFile(config, privateConfig);
  install = await store.install(two, install.revision);
  assert.equal(install.disabled, false); assert.equal(install.versions.length, 2);
  assert.equal(await readFile(config, "utf8"), privateConfig);
  await assert.rejects(store.change(id, install.revision, "activate", "1.0.0"), /版本切换已移除/);
  await assert.rejects(store.install(one, install.revision), /较旧/);
  assert.equal((await store.detail(id)).manifest.version, "1.1.0");
  const altered = automationExampleFiles("1.1.0"); altered.set("scripts/main.mjs", Buffer.from("export default 123"));
  await assert.rejects(store.install(inspectAutomationFiles(altered), install.revision), /相同版本/);
  await assert.rejects(store.change(id, 1, "enable"), /已变化/);
}));

test("legacy version selection migrates to latest without removing old code or configuration", async () => withStore(async store => {
  const first = await store.install(inspectAutomationFiles(automationExampleFiles()), 0);
  const second = await store.install(inspectAutomationFiles(automationExampleFiles("1.1.0")), first.revision);
  const registry = JSON.parse(await readFile(store.registryFile, "utf8")); registry.apps[0].activeVersion = "1.0.0";
  await writeFile(store.registryFile, JSON.stringify(registry));
  await assert.rejects(store.admitRun(first.id, second.revision, async () => true), /重新打开应用/);
  const before = await readFile(join(store.dataDirectory(first.id), "config.json"), "utf8");
  await store.useLatest();
  const latest = await store.find(first.id);
  assert.equal(latest.activeVersion, "1.1.0"); assert.ok(latest.revision > second.revision);
  assert.equal(await readFile(join(store.dataDirectory(first.id), "config.json"), "utf8"), before);
  assert.ok((await lstat(store.codeDirectory(first.id, "1.0.0"))).isDirectory());
  await store.useLatest(); assert.equal((await store.find(first.id)).revision, latest.revision);
}));
test("export reads only published code, never private data or unlisted files; another owner sees no installation", async () => withStore(async (store, base) => {
  const source = inspectAutomationFiles(automationExampleFiles()), install = await store.install(source, 0), id = install.id;
  await writeFile(join(store.dataDirectory(id), "evidence", "response.json"), "private-response");
  await writeFile(join(store.codeDirectory(id, "1.0.0"), "private.json"), "unlisted-private-file");
  const exported = await store.export(id), parsed = parseAutomationAppArchive(exported.bytes);
  assert.equal(parsed.digest, source.digest);
  assert.equal(exported.bytes.includes(Buffer.from("private-response")), false);
  assert.equal(exported.bytes.includes(Buffer.from("unlisted-private-file")), false);
  const foreign = new AutomationAppStore(base, other, () => {});
  assert.deepEqual((await foreign.list()).apps, []); await assert.rejects(foreign.detail(id), /未安装/);
  const imported = await foreign.install(parsed, 0);
  assert.notEqual(foreign.dataDirectory(imported.id), store.dataDirectory(id));
  assert.deepEqual(JSON.parse(await readFile(join(foreign.dataDirectory(id), "config.json"), "utf8")).values, {});
}));
test("uninstall preserves data, reinstall reuses it, and explicit cleanup is independent", async () => withStore(async store => {
  const pkg = inspectAutomationFiles(automationExampleFiles()); let install = await store.install(pkg, 0);
  const file = join(store.dataDirectory(install.id), "artifacts", "result.txt"); await writeFile(file, "local-output");
  const oldRevision = install.revision; await store.uninstall(install.id, install.revision);
  assert.equal((await store.list()).apps.length, 0); assert.equal((await store.list()).data[0].installed, false);
  assert.equal(await readFile(file, "utf8"), "local-output");
  install = await store.install(pkg, 0); assert.equal(await readFile(file, "utf8"), "local-output");
  assert(install.revision > oldRevision);
  await assert.rejects(store.uninstall(install.id, oldRevision), /已变化/);
  await store.clearData(install.id, install.revision);
  assert.equal((await store.list()).apps.length, 1); assert.equal((await store.list()).data.length, 0);
}));

test("explicit uninstall cleanup removes only the current owner's data and workspace", async () => withStore(async (_store, base) => {
  const store = new AutomationAppStore(base, owner, () => {}, { compactWorkspace: true });
  const foreign = new AutomationAppStore(base, other, () => {});
  const pkg = inspectAutomationFiles(automationExampleFiles());
  const install = await store.install(pkg, 0), otherInstall = await foreign.install(pkg, 0);
  const workspace = await store.ensureWorkspace(install.id);
  await writeFile(join(workspace, "private.txt"), "current-owner");
  const otherFile = join(foreign.dataDirectory(otherInstall.id), "artifacts", "keep.txt");
  await writeFile(otherFile, "other-owner");
  await assert.rejects(store.uninstall(install.id, install.revision + 1, undefined, true), /已变化/);
  assert.equal(await readFile(join(workspace, "private.txt"), "utf8"), "current-owner");
  const result = await store.uninstall(install.id, install.revision, undefined, true);
  assert.equal(result.dataRetained, false);
  assert.equal(await store.find(install.id), null);
  await assert.rejects(lstat(store.dataDirectory(install.id)), { code: "ENOENT" });
  await assert.rejects(lstat(workspace), { code: "ENOENT" });
  assert.equal(await readFile(otherFile, "utf8"), "other-owner");
  assert.ok(await foreign.find(otherInstall.id));
}));
test("scanning does not execute code, modified code cannot export, and identity loss blocks mutation", async () => withStore(async (store, base) => {
  const files = automationExampleFiles(); files.set("scripts/main.mjs", Buffer.from("globalThis.__a02StoreExecuted = true; export default 0"));
  const install = await store.install(inspectAutomationFiles(files), 0);
  await store.list(); await store.detail(install.id); assert.equal(globalThis.__a02StoreExecuted, undefined);
  await writeFile(join(store.codeDirectory(install.id, "1.0.0"), "scripts", "main.mjs"), "tampered");
  await assert.rejects(store.export(install.id), /代码与登记不一致/);
  const unauthorized = new AutomationAppStore(base, owner, () => { throw new Error("identity changed"); });
  await assert.rejects(unauthorized.uninstall(install.id, install.revision), /identity changed/);
  assert.equal((await store.list()).apps.length, 1);
}));

test("compact creation workspace copies legacy files once, keeps metadata and export private, and isolates owners", async () => withStore(async (legacy, base) => {
  const pkg = inspectAutomationFiles(automationExampleFiles()), install = await legacy.install(pkg, 0), id = install.id;
  const oldWorkspace = join(legacy.dataDirectory(id), "workspace");
  await mkdir(join(oldWorkspace, "nested"), { recursive: true });
  await writeFile(join(oldWorkspace, "nested", "result.txt"), "legacy-private-output");
  const store = new AutomationAppStore(base, owner, () => {}, { compactWorkspace: true });
  const config = join(store.dataDirectory(id), "config.json"), before = await readFile(config, "utf8");
  const detail = await store.detail(id), workspace = store.workspaceDirectory(id);
  assert.equal(detail.dataDirectory, legacy.dataDirectory(id));
  assert.equal(detail.workspaceDirectory, workspace);
  await assert.rejects(lstat(workspace), { code: "ENOENT" }); // Detail reads do not migrate or execute.
  assert.notEqual(workspace, oldWorkspace);
  assert.notEqual(workspace, new AutomationAppStore(base, other, () => {}, { compactWorkspace: true }).workspaceDirectory(id));
  await store.ensureWorkspace(id);
  assert.equal(await readFile(join(workspace, "nested", "result.txt"), "utf8"), "legacy-private-output");
  assert.equal(await readFile(join(oldWorkspace, "nested", "result.txt"), "utf8"), "legacy-private-output");
  await writeFile(join(workspace, "nested", "result.txt"), "new-output");
  await store.ensureWorkspace(id);
  assert.equal(await readFile(join(workspace, "nested", "result.txt"), "utf8"), "new-output");
  assert.equal(await readFile(config, "utf8"), before);
  assert.equal(parseAutomationAppArchive((await store.export(id)).bytes).digest, pkg.digest);
  await store.uninstall(id, install.revision);
  assert.equal(await readFile(join(workspace, "nested", "result.txt"), "utf8"), "new-output");
  await store.clearData(id, 0);
  await assert.rejects(lstat(workspace), { code: "ENOENT" });
  await assert.rejects(lstat(oldWorkspace), { code: "ENOENT" });
}));

test("compact migration rejects directory links without publishing a partial workspace", async () => withStore(async (legacy, base) => {
  const install = await legacy.install(inspectAutomationFiles(automationExampleFiles()), 0), id = install.id;
  const oldWorkspace = join(legacy.dataDirectory(id), "workspace"), outside = join(base, "outside");
  await mkdir(oldWorkspace, { recursive: true }); await mkdir(outside);
  await writeFile(join(outside, "private.txt"), "do-not-copy");
  await symlink(outside, join(oldWorkspace, "linked"), "junction");
  const store = new AutomationAppStore(base, owner, () => {}, { compactWorkspace: true });
  await assert.rejects(store.ensureWorkspace(id), /链接|联接/);
  await assert.rejects(lstat(store.workspaceDirectory(id)), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(base, "work")), []);
  assert.equal(await readFile(join(outside, "private.txt"), "utf8"), "do-not-copy");
}));
