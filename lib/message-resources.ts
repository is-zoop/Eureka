import type { OrganizationCapabilityRef } from "./organization-capability";

export interface DisplayReference { path: string; isDir: boolean }
/** Consume only a leading run of explicit @ references; prose and line references stay intact. */
export function parseLeadingFileReferences(content: string): { references: DisplayReference[]; body: string } {
  const references: DisplayReference[] = [];
  let offset = 0;
  while (offset < content.length) {
    const start = offset + (content.slice(offset).match(/^\s*/)?.[0].length ?? 0);
    if (content[start] !== "@") break;
    const quoted = content[start + 1] === '"';
    const end = quoted ? content.indexOf('"', start + 2)
      : (() => { const token = content.slice(start + 1).match(/^\S+/)?.[0]; return token ? start + 1 + token.length : -1; })();
    if (end < 0) break;
    const path = content.slice(start + (quoted ? 2 : 1), end);
    // A Windows drive prefix is a path; any other colon (including :line) is prose.
    const rest = /^[a-z]:[\\/]/i.test(path) ? path.slice(2) : path;
    if (!path || rest.includes(":") || (quoted && end + 1 < content.length && !/\s/.test(content[end + 1]))) break;
    const isDir = /[\\/]$/.test(path);
    references.push({ path: isDir && !/^(?:[a-z]:)?[\\/]$/i.test(path) ? path.slice(0, -1) : path, isDir });
    offset = end + (quoted ? 1 : 0);
  }
  return { references, body: references.length ? content.slice(offset).trimStart() : content };
}

export function exactSkillCapability(skills: readonly { name: string; filePath: string; organizationCapability?: OrganizationCapabilityRef }[], name: string, location?: string) {
  const pathKey = (value: string) => { const path = value.replace(/\\/g, "/"); return /^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path; };
  const matching = skills.filter(skill => skill.name === name && (!location || pathKey(skill.filePath) === pathKey(location)));
  return matching.length === 1 ? matching[0].organizationCapability : undefined;
}
