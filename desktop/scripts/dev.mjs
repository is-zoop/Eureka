import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(desktopDir, "..");
// Haze OAuth is registered with the project's loopback callback at port 8080.
const env = { ...process.env, EUREKA_DEV_URL: "http://127.0.0.1:8080" };
const nextBin = join(rootDir, "node_modules", "next", "dist", "bin", "next");
const tauriBin = join(desktopDir, "node_modules", "@tauri-apps", "cli", "tauri.js");

if (!existsSync(nextBin) || !existsSync(tauriBin)) {
  throw new Error("Install root and desktop dependencies before starting Eureka development.");
}

const web = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", "8080"], {
  cwd: rootDir,
  env,
  stdio: "inherit",
});
// Development must not share the production identifier: the single-instance
// plugin would otherwise focus an installed Eureka release instead of opening
// the freshly compiled dev window.
const tauri = spawn(process.execPath, [tauriBin, "dev", "--config", "src-tauri/tauri.dev.conf.json"], {
  cwd: desktopDir,
  env,
  stdio: "inherit",
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [web, tauri]) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
tauri.on("exit", (code) => stop(code ?? 1));
web.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
