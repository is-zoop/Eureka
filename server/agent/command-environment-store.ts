import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CommandEnvironment } from "../../features/settings/shared/command-environment";

export async function readCommandEnvironment(base = getAgentDir()): Promise<CommandEnvironment> {
  try {
    const value = JSON.parse(await readFile(join(base, "eureka-command-environment.json"), "utf8"));
    if (value.environment !== "bash" && value.environment !== "powershell") throw new Error("Invalid command environment");
    return value.environment;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "bash"; throw error; }
}

export async function writeCommandEnvironment(environment: unknown, base = getAgentDir(), platform = process.platform): Promise<CommandEnvironment> {
  if (environment !== "bash" && environment !== "powershell") throw new Error("Invalid command environment");
  if (environment === "powershell" && platform !== "win32") throw new Error("PowerShell is only available on native Windows");
  await mkdir(base, { recursive: true });
  const file = join(base, "eureka-command-environment.json"), temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify({ environment }) + "\n", { flag: "wx", mode: 0o600 }); await rename(temp, file); }
  finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  return environment;
}
