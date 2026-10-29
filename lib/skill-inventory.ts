import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo } from "./api-types";

function fileKey(filePath: string) {
  let canonical: string;
  try { canonical = realpathSync(filePath); } catch { canonical = resolve(filePath); }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

/** Read skill metadata for management, without loading project extensions or granting trust.
 * Runtime discovery may omit untrusted resources or shadow a same-named skill in another scope.
 */
export function readInstalledSkillInventory(loaded: SkillInfo[], { cwd, agentDir, homeDir = homedir() }: {
  cwd: string; agentDir: string; homeDir?: string;
}): SkillInfo[] {
  const records = new Map<string, SkillInfo>();
  const key = (skill: SkillInfo) => {
    const sourceScope = skill.install?.scope ?? skill.sourceInfo.scope ?? skill.sourceInfo.source;
    const scope = sourceScope === "user" ? "global" : sourceScope ?? "path";
    return `${scope}:${fileKey(skill.filePath)}`;
  };
  for (const skill of loaded) records.set(key(skill), skill);
  for (const [dir, scope] of [
    [join(agentDir, "skills"), "user"],
    [join(homeDir, ".agents", "skills"), "user"],
    [join(cwd, ".pi", "skills"), "project"],
    [join(cwd, ".agents", "skills"), "project"],
  ] as const) {
    const { skills } = loadSkillsFromDir({ dir, source: scope });
    for (const skill of skills) {
      const id = key(skill);
      if (!records.has(id)) records.set(id, skill);
    }
  }
  return [...records.values()];
}
