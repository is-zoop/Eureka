import { applyHazeProjectSkillOverrides } from "./haze-skill-overrides";
import { annotateOrganizationSkills } from "./haze-capability-presentation";
import { applyOrganizationPluginSkills } from "./haze-plugin-resources";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";
import { readInstalledSkillInventory } from "./skill-inventory";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir, skillsOverride: (base) => applyOrganizationPluginSkills(cwd, applyHazeProjectSkillOverrides(cwd, base)) });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  const annotate = (items: SkillInfo[]) => annotateOrganizationSkills(cwd, annotateSkillsWithInstallInfo(items, { cwd, agentDir }));
  return {
    skills: annotate(skills as SkillInfo[]),
    installedSkills: annotate(readInstalledSkillInventory(skills as SkillInfo[], { cwd, agentDir })),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
