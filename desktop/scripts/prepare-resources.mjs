import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { copyStandaloneResources } from "./standalone-resources.mjs";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(desktopDir, "..");
const resourcesDir = join(desktopDir, "resources");
const appDir = join(resourcesDir, "app");
const nodeDir = join(resourcesDir, "node");
const nextBin = join(rootDir, "node_modules", "next", "dist", "bin", "next");
const runtimeEnvFile = join(rootDir, ".env.local");
const mcpAdapterDir = join(rootDir, "node_modules", "pi-mcp-adapter");
const piPackageNames = [
  "pi-agent-core",
  "pi-ai",
  "pi-coding-agent",
  "pi-tui",
];
const piPackagesDir = join(rootDir, "node_modules", "@earendil-works");
// Some server-only modules inspect os.homedir() while Next traces the
// production bundle. On Windows the real profile contains protected legacy
// junctions such as "Application Data", so isolate build-time discovery.
const buildHome = join(desktopDir, ".build-home");
const skipBuild = process.argv.includes("--skip-build");

if (!existsSync(nextBin)) {
  throw new Error("Next.js is not installed in the repository root. Run npm install first.");
}
if (!existsSync(mcpAdapterDir)) {
  throw new Error("pi-mcp-adapter is not installed in the repository root. Run npm install first.");
}
for (const packageName of piPackageNames) {
  if (!existsSync(join(piPackagesDir, packageName))) {
    throw new Error(`@earendil-works/${packageName} is not installed in the repository root.`);
  }
}
// Resolve the exact browser revision used by the production dependency.
const require = createRequire(import.meta.url);
const { chromium } = require(join(rootDir, "node_modules", "playwright"));
const chromiumExecutable = chromium.executablePath();
if (!existsSync(chromiumExecutable)) throw new Error("Chromium is missing. Run npm run browser:install before packaging.");
const chromiumRevisionDir = dirname(dirname(chromiumExecutable));
mkdirSync(buildHome, { recursive: true });

if (!skipBuild) {
  const build = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: rootDir,
    env: {
      ...process.env,
      EUREKA_DESKTOP_BUILD: "1",
      HOME: buildHome,
      USERPROFILE: buildHome,
      APPDATA: buildHome,
      LOCALAPPDATA: buildHome,
    },
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}
if (skipBuild) console.log("Reusing the existing Next standalone build.");

const standaloneDir = join(rootDir, ".next", "standalone");
if (!existsSync(join(standaloneDir, "server.js"))) {
  throw new Error("Next standalone output is missing server.js.");
}
if (statSync(process.execPath).isDirectory()) {
  throw new Error("Could not resolve the Node.js executable for the desktop runtime.");
}

// Validate the exact generated directory before recursively replacing it.
if (resourcesDir !== resolve(rootDir, "desktop", "resources")) throw new Error("Invalid desktop resource directory.");
console.log("Replacing generated desktop resources (excluding build outputs and caches).");
rmSync(resourcesDir, { recursive: true, force: true, maxRetries: 3 });
mkdirSync(appDir, { recursive: true });
mkdirSync(nodeDir, { recursive: true });
copyStandaloneResources(standaloneDir, appDir);
// Pi reads themes and other interactive-mode resources from disk at runtime.
// Those JSON assets are accessed dynamically and therefore omitted by Next's
// standalone tracer unless the SDK packages are copied in full.
for (const packageName of piPackageNames) {
  cpSync(
    join(piPackagesDir, packageName),
    join(appDir, "node_modules", "@earendil-works", packageName),
    { recursive: true },
  );
}
// The MCP adapter is loaded through jiti at runtime, which Next's standalone
// output tracer cannot discover. Copy the package (and its nested production
// dependencies) explicitly so AgentSession startup works after installation.
cpSync(mcpAdapterDir, join(appDir, "node_modules", "pi-mcp-adapter"), { recursive: true });
// Header hooks run as plain Node children, outside Next's bundled modules.
mkdirSync(join(appDir, "lib", "auth"), { recursive: true });
for (const file of ["haze-mcp-request-headers.mjs", "haze-plugin-auth.mjs", "auth/haze-runtime-store.mjs"]) {
  copyFileSync(join(rootDir, "lib", file), join(appDir, "lib", file));
}
// Include dependencies used by the unbundled hook even if Next inlines them.
for (const name of ["@next/env", "proper-lockfile", "graceful-fs", "retry", "signal-exit"]) {
  cpSync(join(rootDir, "node_modules", name), join(appDir, "node_modules", name), { recursive: true });
}
cpSync(join(rootDir, "public"), join(appDir, "public"), { recursive: true });
cpSync(join(rootDir, ".next", "static"), join(appDir, ".next", "static"), { recursive: true });
if (existsSync(runtimeEnvFile)) copyFileSync(runtimeEnvFile, join(appDir, ".env.local"));
copyFileSync(process.execPath, join(nodeDir, process.platform === "win32" ? "node.exe" : "node"));

// Playwright is imported dynamically by the server. Include its runtime and the
// matching Chromium revision; never require a first-run browser download.
for (const name of ["playwright", "playwright-core"]) {
  cpSync(join(rootDir, "node_modules", name), join(appDir, "node_modules", name), { recursive: true });
}
cpSync(chromiumRevisionDir, join(appDir, "browser", "chromium"), { recursive: true });
const browserRelativeExecutable = chromiumExecutable.slice(chromiumRevisionDir.length + 1);
// The sidecar resolves this relative path under its own application directory.
const { writeFileSync } = await import("node:fs");
writeFileSync(join(appDir, "browser", "runtime.json"), JSON.stringify({ executable: join("chromium", browserRelativeExecutable) }));
console.log(`Desktop resources ready: ${resourcesDir}`);
