import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
export function readPackageChangelog(directory?: string): string | undefined {
  if (!directory) return;
  try {
    const root = realpathSync(directory), manifestPath = realpathSync(join(root, "package.json"));
    const manifestRelative = relative(root, manifestPath);
    if (isAbsolute(manifestRelative) || manifestRelative.startsWith("..")) return;
    if (statSync(manifestPath).size > 256 * 1024) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const configured = manifest.pi?.changelogPath;
    if (configured === "" || configured !== undefined && typeof configured !== "string") return;
    const file = realpathSync(join(root, configured ?? "CHANGELOG.md")), rel = relative(root, file);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || statSync(file).size > 256 * 1024) return;
    return readFileSync(file, "utf8");
  } catch { return; }
}
