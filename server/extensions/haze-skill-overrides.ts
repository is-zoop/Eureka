import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
/** Pi normally keeps the first matching skill name (global before project).
 * Haze Skill roots are their market slugs, so reload a matching project root
 * and replace the global result before it reaches the session. */
export function applyHazeProjectSkillOverrides(cwd: string, base: { skills: import("@earendil-works/pi-coding-agent").Skill[]; diagnostics: import("@earendil-works/pi-coding-agent").ResourceDiagnostic[] }) {
  const globalRoot = resolve(getAgentDir(), "skills");
  const projectRoot = resolve(cwd, ".pi", "skills");
  const overriddenRoots = new Set<string>();
  for (const skill of base.skills) {
    const globalRelative = relative(globalRoot, dirname(skill.filePath));
    const rootName = globalRelative.split(sep)[0];
    if (globalRelative.startsWith("..") || !globalRelative) continue;
    const projectSkillRoot = resolve(projectRoot, rootName);
    if (existsSync(resolve(projectSkillRoot, "SKILL.md"))) overriddenRoots.add(rootName);
  }
  if (!overriddenRoots.size) return base;
  const skills = base.skills.filter((skill) => {
    const globalRelative = relative(globalRoot, dirname(skill.filePath));
    const projectRelative = relative(projectRoot, dirname(skill.filePath));
    return ![globalRelative, projectRelative].some((path) => overriddenRoots.has(path.split(sep)[0]));
  });
  const diagnostics = [...base.diagnostics];
  for (const rootName of overriddenRoots) {
    const result = loadSkillsFromDir({ dir: resolve(projectRoot, rootName), source: "project" });
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

