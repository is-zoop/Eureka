import { cpSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isRuntimeAsset } from "./standalone-resources.mjs";

export const sdkRuntimePackages = [
  "@earendil-works/pi-agent-core", "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "pi-mcp-adapter",
];

/** Copy the installed production dependency graph, including dynamically loaded JSON/WASM. */
export function copySdkRuntimeResources(root, app, seeds = sdkRuntimePackages) {
  const modules = resolve(root, "node_modules");
  const copied = new Set();
  const findPackage = (name, parent) => {
    const require = createRequire(join(parent, "package.json"));
    for (const search of require.resolve.paths(name) ?? []) {
      const path = join(search, name);
      if (existsSync(join(path, "package.json"))) return path;
    }
    throw new Error(`Missing SDK runtime dependency: ${name}`);
  };
  const visit = (name, parent) => {
    const source = findPackage(name, parent);
    if (copied.has(source)) return;
    const path = relative(modules, source);
    if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error(`SDK dependency is outside node_modules: ${name}`);
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    copied.add(source);
    cpSync(source, join(app, "node_modules", path), {
      recursive: true,
      filter: (file) => isRuntimeAsset(file) && !relative(source, file).split(sep).includes("node_modules"),
    });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!(dependency in (manifest.optionalDependencies ?? {}))) visit(dependency, source);
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      // Optional native packages absent on this target platform remain absent.
      let installed = false;
      try { findPackage(dependency, source); installed = true; } catch { /* platform optional */ }
      if (installed) visit(dependency, source);
    }
  };
  for (const name of seeds) visit(name, resolve(root));
  return [...copied].map((source) => relative(modules, source));
}
