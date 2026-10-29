import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import type { SkillInfo, SkillInstallScope } from "./api-types";
import { annotateSkillsWithInstallInfo, getGlobalSkillsLockPath } from "./skill-lock";
import { readInstalledSkillInventory } from "./skill-inventory";
import { samePath } from "./paths";

type Options = {
  cwd: string; scope: SkillInstallScope; agentDir: string; homeDir?: string;
  globalLockPath?: string; projectLockPath?: string;
};

/** Uninstall only a registered marketplace skill and its aliases in the selected scope.
 * Directory links are removed as links; targets outside these installation roots are never deleted.
 */
export async function uninstallMarketSkill(skill: SkillInfo, options: Options): Promise<void> {
  const { cwd, scope, agentDir, homeDir = homedir() } = options;
  if (!skill.install || skill.install.scope !== scope || skill.managedPlugin || skill.organizationCapability) throw new Error("This skill cannot be uninstalled here");
  const roots = scope === "global" ? [join(agentDir, "skills"), join(homeDir, ".agents", "skills")] : [join(cwd, ".pi", "skills"), join(cwd, ".agents", "skills")];
  const directory = dirname(resolve(skill.filePath));
  if (basename(skill.filePath).toLowerCase() !== "skill.md" || !roots.some(root => samePath(dirname(directory), root))) throw new Error("This skill cannot be uninstalled here");
  const lockPath = scope === "global" ? options.globalLockPath ?? getGlobalSkillsLockPath({ homeDir }) : options.projectLockPath ?? join(cwd, "skills-lock.json");
  const release = await lockfile.lock(lockPath, { realpath: false, retries: { retries: 20, minTimeout: 25, maxTimeout: 100 } });
  const staged: Array<{ original: string; temporary: string }> = [];
  let committed = false;
  const temporaryLock = `${lockPath}.${randomUUID()}.tmp`;
  try {
    const lockStat = await lstat(lockPath);
    if (!lockStat.isFile() || lockStat.isSymbolicLink()) throw new Error("Invalid skill installation record");
    const document = JSON.parse(await readFile(lockPath, "utf8")) as { skills?: Record<string, unknown>; [key: string]: unknown };
    if (!document || typeof document !== "object" || !document.skills || typeof document.skills !== "object" || Array.isArray(document.skills)) throw new Error("Invalid skill installation record");
    const fresh = annotateSkillsWithInstallInfo([{ ...skill, install: undefined }], { ...options, homeDir })[0];
    if (fresh.install?.package !== skill.install.package || fresh.install.scope !== scope) throw new Error("Skill installation changed. Refresh and try again.");
    const selectedTarget = await realpath(directory);
    const plan: string[] = [];
    const physicalEntries: string[] = [];
    for (const root of roots) {
      let entries;
      try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const physicalRoot = await realpath(root);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || !entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const candidate = resolve(root, entry.name);
        // Validate absolute paths before any recursive filesystem mutation.
        if (!samePath(dirname(candidate), resolve(root))) throw new Error("This skill cannot be uninstalled here");
        let target: string;
        try { target = await realpath(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (!samePath(target, selectedTarget)) continue;
        const physicalEntry = join(physicalRoot, entry.name);
        if (physicalEntries.some(previous => samePath(previous, physicalEntry))) continue;
        physicalEntries.push(physicalEntry);
        plan.push(candidate);
      }
    }
    if (!plan.length) throw new Error("Installed skill not found");
    // Stage before updating metadata, so failures before commit restore the original installation.
    for (const original of plan) {
      const temporary = join(dirname(original), `.uninstall-${randomUUID()}`);
      await rename(original, temporary);
      staged.push({ original, temporary });
    }
    const remaining = readInstalledSkillInventory([], { cwd, agentDir, homeDir });
    const sameNameRemains = remaining.some(item => item.name.toLowerCase() === skill.name.toLowerCase() && (item.sourceInfo.scope === (scope === "global" ? "user" : "project")));
    if (!sameNameRemains) {
      const records = { ...document.skills };
      for (const name of Object.keys(records)) if (name.toLowerCase() === skill.name.toLowerCase()) delete records[name];
      await writeFile(temporaryLock, `${JSON.stringify({ ...document, skills: records }, null, 2)}\n`, { encoding: "utf8", mode: lockStat.mode });
      await rename(temporaryLock, lockPath);
    }
    committed = true;
    for (const { temporary } of staged) {
      // Each temporary path is an immediate child of a previously validated installation root.
      if (!roots.some(root => samePath(dirname(temporary), root))) throw new Error("This skill cannot be uninstalled here");
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    if (!committed) for (const { original, temporary } of [...staged].reverse()) await rename(temporary, original);
    throw error;
  } finally {
    try { await rm(temporaryLock, { force: true }); } finally { await release(); }
  }
}
