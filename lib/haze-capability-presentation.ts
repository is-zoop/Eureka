import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readHazeRegistry } from "./haze-registry";
import { validatedPluginRoot } from "./haze-plugin-resources";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";
import type { OrganizationCapabilityRef } from "./organization-capability";

/** Annotate actual resource paths, never names which can belong to local skills. */
export function annotateOrganizationSkills<T extends { filePath?: string }>(cwd: string, skills: readonly T[]): Array<T & { organizationCapability?: OrganizationCapabilityRef }> {
  const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "");
  if (!source) return [...skills];
  const roots: Array<{ root: string; capability: OrganizationCapabilityRef }> = [];
  for (const scope of ["global", "project"] as const) {
    for (const item of readHazeRegistry(cwd, scope).installs) {
      try {
        let root: string;
        if (item.type === "Plugin" && item.plugin?.source === source) {
          root = validatedPluginRoot(cwd, item);
        } else if (item.type === "Skill" && item.skillPath) {
          root = realpathSync(item.skillPath);
          const base = realpathSync(resolve(scope === "global" ? getAgentDir() : resolve(cwd, ".pi"), "skills"));
          if (samePath(root, base) || !isPathWithinRoots(root, new Set([base]))) continue;
        } else continue;
        roots.push({ root, capability: { capabilityId: item.capabilityId, source } });
      } catch { /* Missing or invalid registrations cannot claim another skill's icon. */ }
    }
  }
  roots.sort((a, b) => b.root.length - a.root.length);
  return skills.map((skill) => {
    if (!skill.filePath) return skill;
    try {
      const file = realpathSync(skill.filePath);
      const owner = roots.find(({ root }) => isPathWithinRoots(file, new Set([root])));
      return owner ? { ...skill, organizationCapability: owner.capability } : skill;
    } catch { return skill; }
  });
}
