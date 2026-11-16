import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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

// Source maps are not used by the packaged runtime and may exceed NSIS MAX_PATH.
export function isRuntimeAsset(source) {
  return !/\.(?:[cm]?[jt]s|css)\.map$|\.tsbuildinfo$/i.test(source);
}

export function standaloneResourceFilter(root) {
  const sourceRoot = resolve(root);
  return (source) => {
    const name = relative(sourceRoot, resolve(source));
    if (!name) return true;
    if (isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`)) return false;
    const parts = name.split(sep);
    if (!isRuntimeAsset(source)) return false;
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

// Next's standalone trace can omit transitive runtime dependencies of the
// instrumentation hook, such as generator-function/require.mjs.
export function copyMissingStandaloneDependencies(root, app, seeds = []) {
  const sourceModules = resolve(root, "node_modules");
  const destModules = resolve(app, "node_modules");
  const copied = [];
  const seen = new Set();

  const findPackage = (name, parent, modulesRoot) => {
    const require = createRequire(join(parent, "package.json"));
    for (const search of require.resolve.paths(name) ?? []) {
      const resolved = resolve(search);
      const modules = resolve(modulesRoot);
      if (resolved !== modules && !resolved.startsWith(modules + sep)) continue;
      const path = join(search, name);
      if (existsSync(join(path, "package.json"))) return path;
    }
    return null;
  };

  const visitManifest = (parent, manifest) => {
    for (const name of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      if (findPackage(name, parent, destModules)) continue;
      const source = findPackage(name, parent, sourceModules) ?? findPackage(name, resolve(root), sourceModules);
      if (!source) continue;
      const path = relative(sourceModules, source);
      if (isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) {
        throw new Error("Standalone dependency is outside node_modules: " + name);
      }
      if (seen.has(source)) continue;
      seen.add(source);
      const destination = join(destModules, path);
      cpSync(source, destination, {
        recursive: true,
        filter: (file) => isRuntimeAsset(file) && !relative(source, file).split(sep).includes("node_modules"),
      });
      copied.push(path);
      visitManifest(destination, JSON.parse(readFileSync(join(destination, "package.json"), "utf8")));
    }
  };

  if (!existsSync(destModules)) return copied;
  for (const name of seeds) {
    const source = findPackage(name, resolve(root), sourceModules);
    if (!source) throw new Error("Missing standalone runtime dependency: " + name);
    const path = relative(sourceModules, source);
    if (isAbsolute(path) || path === ".." || path.startsWith(".." + sep)) {
      throw new Error("Standalone dependency is outside node_modules: " + name);
    }
    if (findPackage(name, resolve(app), destModules)) continue;
    if (seen.has(source)) continue;
    seen.add(source);
    const destination = join(destModules, path);
    cpSync(source, destination, {
      recursive: true,
      filter: (file) => isRuntimeAsset(file) && !relative(source, file).split(sep).includes("node_modules"),
    });
    copied.push(path);
  }
  for (const entry of readdirSync(destModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const packages = entry.name.startsWith("@")
      ? readdirSync(join(destModules, entry.name), { withFileTypes: true })
          .filter((child) => child.isDirectory())
          .map((child) => join(destModules, entry.name, child.name))
      : [join(destModules, entry.name)];
    for (const dir of packages) {
      if (!existsSync(join(dir, "package.json"))) continue;
      visitManifest(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
    }
  }
  return copied;
}
