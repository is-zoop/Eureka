import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

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
mkdirSync(buildHome, { recursive: true });

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

const standaloneDir = join(rootDir, ".next", "standalone");
if (!existsSync(join(standaloneDir, "server.js"))) {
  throw new Error("Next standalone output is missing server.js.");
}
if (statSync(process.execPath).isDirectory()) {
  throw new Error("Could not resolve the Node.js executable for the desktop runtime.");
}

rmSync(resourcesDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(nodeDir, { recursive: true });
cpSync(standaloneDir, appDir, { recursive: true });
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
cpSync(join(rootDir, "public"), join(appDir, "public"), { recursive: true });
cpSync(join(rootDir, ".next", "static"), join(appDir, ".next", "static"), { recursive: true });
if (existsSync(runtimeEnvFile)) copyFileSync(runtimeEnvFile, join(appDir, ".env.local"));
copyFileSync(process.execPath, join(nodeDir, process.platform === "win32" ? "node.exe" : "node"));
