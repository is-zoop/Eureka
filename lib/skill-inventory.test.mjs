import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readInstalledSkillInventory } = await jiti.import("./skill-inventory.ts");
const { annotateSkillsWithInstallInfo } = await jiti.import("./skill-lock.ts");
const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eureka-skill-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { cwd: join(root, "project"), homeDir: join(root, "home"), agentDir: join(root, "home", ".pi", "agent") };
  for (const dir of Object.values(options)) mkdirSync(dir, { recursive: true });
  return { root, ...options };
}

function writeSkill(dir, name, disabled = false) {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, `---\nname: ${name}\ndescription: Inventory test\n${disabled ? "disable-model-invocation: true\n" : ""}---\nInstructions\n`);
  return filePath;
}

test("lists an untrusted project's installed skill without executing its extensions", async t => {
  const options = fixture(t);
  const filePath = writeSkill(join(options.cwd, ".agents", "skills", "agent-browser"), "agent-browser");
  const marker = join(options.root, "executed");
  const extension = join(options.cwd, ".pi", "extensions", "probe.js");
  mkdirSync(dirname(extension), { recursive: true });
  writeFileSync(extension, `import {writeFileSync} from 'node:fs'; export default () => writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  const loader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: options.agentDir });
  await loader.reload({ resolveProjectTrust: async () => false });
  const loaded = loader.getSkills().skills;
  assert.equal(loaded.some(skill => skill.filePath === filePath), false);
  const installed = readInstalledSkillInventory(loaded, options);
  assert.ok(installed.some(skill => skill.filePath === filePath && skill.sourceInfo.scope === "project"));
  assert.equal(loader.getSkills().skills.some(skill => skill.filePath === filePath), false);
  assert.equal(existsSync(marker), false);
});

test("keeps both scopes for same-named skills, including disabled skills", t => {
  const options = fixture(t);
  writeSkill(join(options.agentDir, "skills", "shared"), "shared");
  writeSkill(join(options.cwd, ".pi", "skills", "shared"), "shared", true);
  const installed = readInstalledSkillInventory([], options);
  assert.equal(installed.length, 2);
  assert.deepEqual(installed.map(skill => skill.sourceInfo.scope).sort(), ["project", "user"]);
  assert.equal(installed.find(skill => skill.sourceInfo.scope === "project").disableModelInvocation, true);
});

test("deduplicates Pi aliases by real path and retains runtime metadata", t => {
  const options = fixture(t);
  const target = join(options.homeDir, ".agents", "skills", "browser");
  writeSkill(target, "browser");
  const alias = join(options.agentDir, "skills", "browser");
  mkdirSync(dirname(alias), { recursive: true });
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  const [skill] = readInstalledSkillInventory([], options);
  const annotated = { ...skill, managedPlugin: { capabilityId: "owned", name: "Owned", scope: "global" }, install: { scope: "global" } };
  const installed = readInstalledSkillInventory([annotated], options);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].managedPlugin.capabilityId, "owned");
});

test("resolves lock metadata from canonical .agents paths in the correct scope", t => {
  const options = fixture(t);
  writeSkill(join(options.homeDir, ".agents", "skills", "browser"), "browser");
  writeSkill(join(options.cwd, ".agents", "skills", "browser"), "browser");
  const globalLockPath = join(options.root, "global-lock.json");
  const projectLockPath = join(options.cwd, "skills-lock.json");
  const lock = source => JSON.stringify({ skills: { browser: { source, sourceType: "github" } } });
  writeFileSync(globalLockPath, lock("global/repo"));
  writeFileSync(projectLockPath, lock("project/repo"));
  const installed = annotateSkillsWithInstallInfo(readInstalledSkillInventory([], options), { ...options, globalLockPath, projectLockPath });
  assert.deepEqual(installed.map(skill => [skill.install.scope, skill.install.package]), [
    ["global", "global/repo@browser"], ["project", "project/repo@browser"],
  ]);
});
