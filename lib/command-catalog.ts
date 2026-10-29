import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyHazeProjectSkillOverrides } from "./haze-skill-overrides";
import { applyOrganizationPluginSkills } from "./haze-plugin-resources";
import { annotateOrganizationSkills } from "./haze-capability-presentation";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import type { OrganizationCapabilityRef } from "./organization-capability";
import type { SkillInfo } from "./api-types";

export interface CatalogCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: { path: string; source: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; baseDir?: string };
  organizationCapability?: OrganizationCapabilityRef;
}

/** Read resources without importing extension factories or running session_start. */
export async function readCommandResources(cwd: string, agentDir = getAgentDir()) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir, noExtensions: true, noThemes: true, noContextFiles: true,
    skillsOverride: (base) => applyOrganizationPluginSkills(cwd, applyHazeProjectSkillOverrides(cwd, base)),
  });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills: loadedSkills, diagnostics } = loader.getSkills();
  const skills = annotateOrganizationSkills(cwd, loadedSkills);
  const commands: CatalogCommand[] = [
    ...loader.getPrompts().prompts.map((prompt) => ({ name: prompt.name, description: prompt.description, source: "prompt" as const, sourceInfo: prompt.sourceInfo })),
    ...skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill" as const, sourceInfo: skill.sourceInfo, organizationCapability: skill.organizationCapability })),
  ];
  return { commands, skills: skills as SkillInfo[], diagnostics, projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted };
}

type Resources = Awaited<ReturnType<typeof readCommandResources>>;
type Cache = { data?: Resources; expiresAt: number; pending?: Promise<Resources> };
declare global { var __eurekaCommandResources: Map<string, Cache> | undefined; }

/** Coalesce the command and skill-metadata requests made by the same palette. */
export function loadCommandResources(cwd: string, force = false): Promise<Resources> {
  const agentDir = getAgentDir();
  const trusted = getProjectTrustStatus(cwd, agentDir).trusted;
  const key = JSON.stringify([cwd, agentDir, trusted, readRuntimeHazeSession()?.principal.subject ?? null]);
  const cache = globalThis.__eurekaCommandResources ??= new Map();
  const existing = cache.get(key);
  if (!force && existing?.data && existing.expiresAt > Date.now()) return Promise.resolve(existing.data);
  if (!force && existing?.pending) return existing.pending;
  while (cache.size >= 32) cache.delete(cache.keys().next().value!);
  const entry: Cache = { expiresAt: 0 };
  cache.set(key, entry);
  entry.pending = readCommandResources(cwd, agentDir).then((data) => {
    entry.data = data; entry.expiresAt = Date.now() + 15_000;
    return data;
  }).finally(() => { entry.pending = undefined; if (!entry.data && cache.get(key) === entry) cache.delete(key); });
  return entry.pending;
}
