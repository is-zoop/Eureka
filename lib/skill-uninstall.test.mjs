import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { uninstallMarketSkill } = await jiti.import("./skill-uninstall.ts");
const { readInstalledSkillInventory } = await jiti.import("./skill-inventory.ts");
const { annotateSkillsWithInstallInfo } = await jiti.import("./skill-lock.ts");

function fixture(t) {
  const root = resolve(mkdtempSync(join(tmpdir(), "eureka-skill-uninstall-")));
  t.after(() => { assert.equal(dirname(root), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const options = { cwd: join(root, "project"), homeDir: join(root, "home"), agentDir: join(root, "agent"), globalLockPath: join(root, "global-lock.json"), projectLockPath: join(root, "project", "skills-lock.json") };
  for (const dir of [options.cwd, options.homeDir, options.agentDir]) mkdirSync(dir, { recursive: true });
  const record = { source: "owner/repo", sourceType: "github", computedHash: "hash", skillFolderHash: "hash" };
  const document = { version: 3, extra: "preserve", skills: { browser: record, keep: record } };
  for (const path of [options.globalLockPath, options.projectLockPath]) writeFileSync(path, JSON.stringify(document));
  const writeSkill = (dir, name = "browser") => { mkdirSync(dir, { recursive: true }); const path = join(dir, "SKILL.md"); writeFileSync(path, `---\nname: ${name}\ndescription: Uninstall test\n---\nInstructions\n`); return path; };
  const selected = scope => annotateSkillsWithInstallInfo(readInstalledSkillInventory([], options), options).find(s => s.install?.scope === scope && s.name === "browser");
  const link = (target, alias) => { mkdirSync(dirname(alias), { recursive: true }); symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir"); };
  return { root, options, writeSkill, selected, link };
}

for (const scope of ["project", "global"]) test(`uninstalls ${scope} canonical directory and Pi alias, preserving the other scope and lock records`, async t => {
  const { options, writeSkill, selected, link } = fixture(t);
  const canonical = join(scope === "global" ? options.homeDir : options.cwd, ".agents", "skills", "browser");
  const alias = join(scope === "global" ? options.agentDir : join(options.cwd, ".pi"), "skills", "browser");
  const other = writeSkill(join(scope === "global" ? options.cwd : options.homeDir, ".agents", "skills", "browser"));
  const keep = writeSkill(join(dirname(canonical), "keep"), "keep");
  writeSkill(canonical); link(canonical, alias);
  const lock = scope === "global" ? options.globalLockPath : options.projectLockPath;
  const otherLock = scope === "global" ? options.projectLockPath : options.globalLockPath;
  const otherBefore = readFileSync(otherLock, "utf8");
  await uninstallMarketSkill(selected(scope), { ...options, scope });
  assert.equal(existsSync(canonical), false); assert.equal(existsSync(alias), false);
  assert.ok(existsSync(other)); assert.ok(existsSync(keep));
  const metadata = JSON.parse(readFileSync(lock, "utf8"));
  assert.deepEqual(Object.keys(metadata.skills), ["keep"]); assert.equal(metadata.extra, "preserve"); assert.equal(metadata.version, 3);
  assert.equal(readFileSync(otherLock, "utf8"), otherBefore);
});

test("removes external directory links without deleting their source", async t => {
  const { root, options, writeSkill, selected, link } = fixture(t);
  const target = join(root, "external", "browser"); const source = writeSkill(target);
  const alias = join(options.cwd, ".agents", "skills", "browser"); link(target, alias);
  await uninstallMarketSkill(selected("project"), { ...options, scope: "project" });
  assert.equal(existsSync(alias), false); assert.ok(existsSync(source));
});

test("retains the lock record when an independent same-named installation remains", async t => {
  const { options, writeSkill, selected } = fixture(t);
  const first = writeSkill(join(options.cwd, ".pi", "skills", "browser"));
  const second = writeSkill(join(options.cwd, ".agents", "skills", "browser"));
  await uninstallMarketSkill(selected("project"), { ...options, scope: "project" });
  assert.equal(existsSync(first), false); assert.ok(existsSync(second));
  assert.ok(JSON.parse(readFileSync(options.projectLockPath, "utf8")).skills.browser);
});

test("rejects cross-scope, managed, nested, or changed installations before mutation", async t => {
  const { options, writeSkill, selected } = fixture(t);
  const path = writeSkill(join(options.cwd, ".agents", "skills", "browser")); const skill = selected("project");
  for (const value of [{ ...skill, install: undefined }, { ...skill, managedPlugin: { capabilityId: "owned" } }, { ...skill, organizationCapability: { capabilityId: "owned" } }, { ...skill, filePath: join(options.cwd, ".agents", "skills", "nested", "browser", "SKILL.md") }]) {
    await assert.rejects(uninstallMarketSkill(value, { ...options, scope: "project" }), /cannot be uninstalled/);
  }
  await assert.rejects(uninstallMarketSkill(skill, { ...options, scope: "global" }), /cannot be uninstalled/);
  writeFileSync(options.projectLockPath, JSON.stringify({ skills: { browser: { source: "other/repo", sourceType: "github" } } }));
  await assert.rejects(uninstallMarketSkill(skill, { ...options, scope: "project" }), /installation changed/);
  assert.ok(existsSync(path));
});

test("concurrent uninstalls preserve each other's metadata changes", async t => {
  const { options, writeSkill, selected } = fixture(t);
  writeSkill(join(options.cwd, ".agents", "skills", "browser")); writeSkill(join(options.cwd, ".agents", "skills", "keep"), "keep");
  const browser = selected("project");
  const keep = annotateSkillsWithInstallInfo(readInstalledSkillInventory([], options), options).find(s => s.name === "keep");
  await Promise.all([uninstallMarketSkill(browser, { ...options, scope: "project" }), uninstallMarketSkill(keep, { ...options, scope: "project" })]);
  assert.deepEqual(JSON.parse(readFileSync(options.projectLockPath, "utf8")).skills, {});
});
