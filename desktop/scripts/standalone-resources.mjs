import { cpSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// These are build inputs/outputs and local caches, never server runtime assets.
export const desktopTraceExcludes = [
  "**/desktop/**",
  "**/.cache/**",
  "**/.tmp/**",
  "**/.git/**",
  "**/.next/cache/**",
  "**/.next/dev/**",
  "**/.next/standalone/**",
];

export function standaloneResourceFilter(root) {
  const sourceRoot = resolve(root);
  return (source) => {
    const name = relative(sourceRoot, resolve(source));
    if (!name) return true;
    if (isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`)) return false;
    const parts = name.split(sep);
    if (["desktop", ".cache", ".tmp", ".git"].includes(parts[0])) return false;
    return !(parts[0] === ".next" && ["cache", "dev", "standalone"].includes(parts[1]));
  };
}

export function copyStandaloneResources(source, destination) {
  const nested = relative(resolve(source), resolve(destination));
  if (!nested || (!isAbsolute(nested) && nested !== ".." && !nested.startsWith(`..${sep}`))) {
    throw new Error("Standalone resources must be copied outside their source directory.");
  }
  // Defense in depth for existing standalone output generated before tracing
  // exclusions were added. Skip directories before visiting their contents.
  cpSync(source, destination, { recursive: true, filter: standaloneResourceFilter(source) });
}
