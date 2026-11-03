import { cpSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// These are build inputs/outputs and local caches, never server runtime assets.
export const desktopTraceExcludes = [
  "**/desktop/**",
  "**/.cache/**",
  "**/.tmp/**",
  "**/.git/**",
  "**/.env",
  "**/.env.*",
  "**/.signing/**",
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
    if (parts.some(part => part === ".env" || part.startsWith(".env.") || part === ".signing")) return false;
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

// Next's standalone trace can omit transitively loaded instrumentation chunks.
// Include the complete server output from the same production build.
export function copyStandaloneServerAssets(buildDirectory, appDirectory) {
  const buildId = readFileSync(resolve(buildDirectory, "BUILD_ID"), "utf8").trim();
  const standaloneId = readFileSync(resolve(appDirectory, ".next", "BUILD_ID"), "utf8").trim();
  if (!buildId || buildId !== standaloneId) throw new Error("Standalone resources belong to a different Next build. Rebuild before packaging.");
  cpSync(resolve(buildDirectory, "server"), resolve(appDirectory, ".next", "server"), { recursive: true });
}
