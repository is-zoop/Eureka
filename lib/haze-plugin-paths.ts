import { existsSync } from "node:fs";
import { getAllowedFileRoots } from "./file-access";
import { readHazeRegistry } from "./haze-registry";
import { validatedPluginRoot } from "./haze-plugin-resources";
import { isExistingPathWithinRoots } from "./path-security";

/** Only registered package directories are exposed, never the entire agent dir. */
export async function registeredPluginRoots(): Promise<Set<string>> {
  const roots = new Set<string>();
  const cwds = await getAllowedFileRoots();
  // The global registry is independent of cwd and only needs to be read once.
  let includeGlobal = true;
  for (const cwd of cwds) {
    for (const scope of includeGlobal ? ["global", "project"] as const : ["project"] as const) {
      try { for (const item of readHazeRegistry(cwd, scope).installs) if (item.type === "Plugin") roots.add(validatedPluginRoot(cwd, item)); } catch { /* Invalid installations do not grant access. */ }
    }
    includeGlobal = false;
  }
  return roots;
}
export async function isManagedPluginPath(path: string) { return existsSync(path) && isExistingPathWithinRoots(path, await registeredPluginRoots()); }
