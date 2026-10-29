/** Display identity of a capability installed from the enterprise catalog. */
export interface OrganizationCapabilityRef { capabilityId: string; source?: string }

/** UI labels are localized separately from the protocol's capability type values. */
export function capabilityTypeLabelKey(type: "Skill" | "MCP" | "Plugin") {
  return { Skill: "extensions.skills", MCP: "extensions.mcp", Plugin: "extensions.plugins" }[type];
}

export function organizationCapabilityIconUrl(capability: OrganizationCapabilityRef): string | null {
  if (!/^\d+$/.test(capability.capabilityId)) return null;
  const path = `/api/organization-extensions/${encodeURIComponent(capability.capabilityId)}/icon`;
  return capability.source ? `${path}?source=${encodeURIComponent(capability.source)}` : path;
}

function resourcePathKey(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

/** Enrich live command paths from the skill listing, including pre-existing sessions. */
export function annotateSkillCommandCapabilities<T extends { source: string; name: string; sourceInfo?: { path: string } }>(
  commands: readonly T[],
  skills: ReadonlyArray<{ name: string; filePath: string; organizationCapability?: OrganizationCapabilityRef }>,
): Array<T & { organizationCapability?: OrganizationCapabilityRef }> {
  const byPath = new Map(skills.map((skill) => [resourcePathKey(skill.filePath), skill]));
  return commands.map((command) => {
    if (command.source !== "skill" || !command.sourceInfo?.path) return command;
    const skill = byPath.get(resourcePathKey(command.sourceInfo.path));
    if (!skill?.organizationCapability || command.name !== `skill:${skill.name}`) return command;
    return { ...command, organizationCapability: skill.organizationCapability };
  });
}
