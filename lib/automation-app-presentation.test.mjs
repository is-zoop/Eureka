import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { automationExampleFiles } = await jiti.import("./automation-app-example.ts");
const { inspectAutomationFiles, parseAutomationAppArchive } = await jiti.import("./automation-app-package.ts");
const { parseAppEditValues } = await jiti.import("./automation-app-presentation.ts");
const icon = { name: "icon.png", type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=" };
const edits = { displayName: "My renamed app", description: "Updated description", categoryId: 2, tags: ["Files", " Files ", "Tools"], icon };
async function fixture(work) {
  const base = await mkdtemp(join(tmpdir(), "eureka-app-edit-"));
  try {
    const store = new AutomationAppStore(base, "a".repeat(64), () => {}), pkg = inspectAutomationFiles(automationExampleFiles());
    const install = await store.install(pkg, 0); await work({ store, pkg, install, base });
  } finally { await rm(base, { recursive: true, force: true }); }
}
test("editing app presentation changes list/detail while retaining package identity, digest and user data", async () => fixture(async ({ store, pkg, install }) => {
  const config = join(store.dataDirectory(install.id), "config.json"), privateData = '{"values":{"private":"keep-me"}}';
  await writeFile(config, privateData);
  const edited = await store.edit(install.id, install.revision, edits, [1, 2]);
  assert.equal(edited.id, install.id); assert.equal(edited.name, install.name); assert.equal(edited.activeVersion, install.activeVersion);
  assert.ok(edited.revision > install.revision); assert.deepEqual(edited.versions, install.versions);
  const detail = await store.detail(install.id); assert.equal(detail.manifest.displayName, edits.displayName); assert.equal(detail.manifest.description, edits.description);
  assert.equal((await store.list()).apps[0].displayName, edits.displayName); assert.deepEqual(detail.install.presentation.tags, ["Files", "Tools"]);
  assert.equal(parseAutomationAppArchive((await store.export(install.id)).bytes).digest, pkg.digest);
  assert.equal(await readFile(config, "utf8"), privateData);
  assert.equal((await store.presentationIcon(install.id)).bytes.toString("base64"), icon.data);
  const values = await store.editValues(install.id); assert.equal(values.icon.data, icon.data); assert.equal(values.categoryId, 2);
}));
test("custom app presentation survives code updates and runtime data cleanup", async () => fixture(async ({ store, install }) => {
  let current = await store.edit(install.id, install.revision, edits, [2]);
  current = await store.install(inspectAutomationFiles(automationExampleFiles("1.1.0")), current.revision);
  assert.equal(current.displayName, edits.displayName); assert.equal(current.activeVersion, "1.1.0");
  assert.equal(current.presentation.description, edits.description); assert.equal(current.presentation.categoryId, 2);
  await store.clearData(install.id, current.revision);
  assert.equal((await store.presentationIcon(install.id)).bytes.toString("base64"), icon.data);
  assert.equal((await store.detail(install.id)).manifest.displayName, edits.displayName);
}));
test("icon preservation/removal, concurrent edits, Haze categories and account isolation are enforced", async () => fixture(async ({ store, install, base }) => {
  let current = await store.edit(install.id, install.revision, edits, [2]);
  await assert.rejects(store.edit(install.id, install.revision, edits, [2]), /已变化/);
  await assert.rejects(store.edit(install.id, current.revision, { ...edits, categoryId: 3 }, [2]), /分类/);
  current = await store.edit(install.id, current.revision, { ...edits, icon: undefined }, [2]);
  assert.equal((await store.presentationIcon(install.id)).bytes.toString("base64"), icon.data);
  const other = new AutomationAppStore(base, "b".repeat(64), () => {});
  await assert.rejects(other.presentationIcon(install.id), /不存在/);
  await store.edit(install.id, current.revision, { ...edits, icon: null }, [2]);
  await assert.rejects(store.presentationIcon(install.id), /不存在/);
  for (const patch of [{ icon: { ...icon, type: "image/svg+xml" } }, { icon: { ...icon, data: "aGVsbG8=" } }, { displayName: "\n" }, { tags: ["x".repeat(51)] }, { injected: "unexpected" }]) assert.throws(() => parseAppEditValues({ ...edits, ...patch }, [2]));
}));
