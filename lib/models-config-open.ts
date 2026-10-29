import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getModelsConfigPath } from "./models-config-store";

/** Open only the active models configuration, never a client-supplied path. */
export async function openModelsConfigFile(
  modelsPath = getModelsConfigPath(),
  launch: typeof spawn = spawn,
): Promise<void> {
  await mkdir(dirname(modelsPath), { recursive: true });
  try {
    await writeFile(modelsPath, '{\n  "providers": {}\n}\n', { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (!(await stat(modelsPath)).isFile()) throw new Error("Models configuration is not a file");

  const command = process.platform === "win32" ? "notepad.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "darwin" ? ["-t", modelsPath] : [modelsPath];
  await new Promise<void>((resolve, reject) => {
    const child = launch(command, args, { shell: false, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); if (process.platform === "win32") resolve(); });
    if (process.platform !== "win32") {
      child.once("exit", (code) => { if (code === 0) resolve(); else reject(new Error("Text editor could not be opened")); });
    }
  });
}
