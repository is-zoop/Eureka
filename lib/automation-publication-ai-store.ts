import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PUBLICATION_AI_SETTINGS, parsePublicationAiSettings } from "./automation-publication-ai-settings";
import { localAutomationPath } from "./automation-local-context";

const filename = "automation-publication-ai.json";
export async function readPublicationAiSettings(base = getAgentDir()) {
  try { return parsePublicationAiSettings(JSON.parse(await readFile(localAutomationPath(base, join(base, filename)), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_PUBLICATION_AI_SETTINGS); throw error; }
}
export async function writePublicationAiSettings(value: unknown, base = getAgentDir(), check = () => {}) {
  const settings = parsePublicationAiSettings(value);
  await mkdir(base, { recursive: true });
  const file = localAutomationPath(base, join(base, filename)), temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(settings) + "\n", { flag: "wx", mode: 0o600 });
    check(); localAutomationPath(base, file);
    await rename(temp, file);
  } finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  return settings;
}
