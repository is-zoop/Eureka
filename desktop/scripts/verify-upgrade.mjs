import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skippedDirectories = new Set(["profiles", "node_modules", ".git", ".cache", "logs"]);

export async function snapshotUpgradeData(roots) {
  const files = [], skippedLinks = [];
  async function inspect(rootId, path, relativePath = "") {
    let info;
    try { info = await lstat(path); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (info.isSymbolicLink()) { skippedLinks.push(`${rootId}/${relativePath}`); return; }
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (skippedDirectories.has(name)) continue;
        await inspect(rootId, join(path, name), relativePath ? `${relativePath}/${name}` : name);
      }
      return;
    }
    if (!info.isFile()) return;
    const selected = rootId === "sessions" ? relativePath.endsWith(".jsonl")
      : rootId === "configuration" ? ["settings.json", "models.json", "auth.json", "eureka-haze-runtime-session.json"].includes(relativePath)
      : rootId === "desktop" ? ["session-secret", "window-state.json"].includes(relativePath)
      : rootId === "automation" ? /(?:^|\/)(?:registry|application)\.json$/.test(relativePath)
      : /(?:^|\/)account\.json$/.test(relativePath);
    if (!selected) return;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const after = await lstat(path);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("A data file changed during inspection. Exit Eureka before taking the snapshot.");
    files.push({ root: rootId, path: relativePath, size: info.size, sha256: hash.digest("hex") });
  }
  for (const [id, path] of Object.entries(roots)) {
    if (id === "configuration" || id === "desktop") {
      // Avoid recursively walking unrelated agent resources or WebView caches.
      const names = id === "configuration" ? ["settings.json", "models.json", "auth.json", "eureka-haze-runtime-session.json"] : ["session-secret", "window-state.json"];
      for (const name of names) await inspect(id, join(path, name), name);
    } else await inspect(id, path);
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), roots, files, skippedLinks };
}

export function compareUpgradeData(before, after) {
  if (before.schemaVersion !== 1 || after.schemaVersion !== 1) throw new Error("Unsupported verification snapshot format.");
  if (JSON.stringify(before.roots) !== JSON.stringify(after.roots)) throw new Error("Snapshots use different data locations; compare them on the same Windows profile.");
  const key = file => `${file.root}/${file.path}`;
  const previous = new Map(before.files.map(file => [key(file), file]));
  const current = new Map(after.files.map(file => [key(file), file]));
  const missing = [], changed = [], added = [];
  for (const [name, file] of previous) {
    if (!current.has(name)) missing.push(name);
    else if (current.get(name).sha256 !== file.sha256) changed.push(name);
  }
  for (const name of current.keys()) if (!previous.has(name)) added.push(name);
  const sessionKeyChanged = changed.includes("desktop/session-secret");
  return { schemaVersion: 1, comparedAt: new Date().toISOString(), passed: missing.length === 0 && !sessionKeyChanged && before.skippedLinks.length === 0 && after.skippedLinks.length === 0, missing, changed, added, sessionKeyChanged, skippedLinks: [...new Set([...before.skippedLinks, ...after.skippedLinks])], note: "This checks file retention and the local session-key fingerprint only. Changed files require review; startup, login, cookies and actual upgrade behavior require the manual checklist." };
}

async function main() {
  const mode = process.argv[2];
  if (!["before", "after"].includes(mode)) {
    console.log("Usage: npm run desktop:verify -- before|after\nExit Eureka first. Reports are saved locally under desktop/verification/. No installer, login, network request or task is started.");
    return;
  }
  if (process.platform !== "win32" || !process.env.APPDATA || !process.env.LOCALAPPDATA) throw new Error("Run installed-desktop verification from your Windows user profile.");
  const agent = join(homedir(), ".pi/agent");
  const roots = { sessions: join(agent, "sessions"), configuration: agent, automation: join(agent, "app-data"), desktop: join(process.env.APPDATA, "com.eureka.desktop"), accounts: join(process.env.LOCALAPPDATA, "com.eureka.desktop/website-accounts") };
  const directory = join(project, "desktop/verification");
  const baselinePath = join(directory, "before.json");
  if (mode === "before") {
    try { await lstat(baselinePath); throw new Error("A baseline already exists. Archive desktop/verification/before.json before starting another acceptance run."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const current = await snapshotUpgradeData(roots);
  if (!current.files.length) throw new Error("No installed-user data was found. Install and initialize the baseline release first.");
  await mkdir(directory, { recursive: true });
  if (mode === "before") {
    await writeFile(baselinePath, JSON.stringify(current, null, 2) + "\n", { flag: "wx" });
    console.log(`Saved a baseline for ${current.files.length} data files; values and credentials were not exported.`);
  } else {
    const before = JSON.parse(await readFile(baselinePath, "utf8"));
    const report = compareUpgradeData(before, current);
    await writeFile(join(directory, "after.json"), JSON.stringify(current, null, 2) + "\n");
    await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`File retention: ${report.passed ? "PASS" : "REVIEW REQUIRED"}; missing ${report.missing.length}, changed ${report.changed.length}, added ${report.added.length}. See desktop/verification/report.json. Complete the manual checklist before publishing.`);
    if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
