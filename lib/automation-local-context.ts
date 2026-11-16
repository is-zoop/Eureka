import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AutomationAppError } from "./automation-app-package";

const ownerPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export interface LocalAutomationProfile { schemaVersion: 1; workspaceId: string; ownerKey: string }

/** Only installation-owned local paths are discoverable; never follow junctions. */
export function localAutomationPath(base: string, path: string) {
  const root = resolve(base), target = resolve(path), part = relative(root, target);
  if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new AutomationAppError("本地自动化路径越界", 403);
  let current = root;
  for (const name of ["", ...part.split(sep).filter(Boolean)]) {
    if (name) current = join(current, name);
    try { if (lstatSync(current).isSymbolicLink()) throw new AutomationAppError("本地自动化目录不允许链接或目录联接", 409); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
  return target;
}

export function localAutomationNamespaces(base = getAgentDir()): string[] {
  const root = localAutomationPath(base, join(base, "app-data"));
  try {
    return readdirSync(root, { withFileTypes: true }).filter(entry => ownerPattern.test(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name).sort();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export function readLocalAutomationJson(base: string, path: string, max = 4 * 1024 * 1024): unknown {
  const file = localAutomationPath(base, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.size > max) throw new AutomationAppError("本地自动化登记文件无效或过大", 409);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function localAutomationContext(base = getAgentDir()) {
  const file = localAutomationPath(base, join(base, "eureka-local-automation.json"));
  let profile: LocalAutomationProfile;
  try { profile = readLocalAutomationJson(base, file, 4096) as LocalAutomationProfile; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const workspaceId = randomUUID();
    // Reuse the first legacy storage namespace without moving any package,
    // file grant or browser account. This is a storage key, never a login.
    const ownerKey = localAutomationNamespaces(base)[0] ?? createHash("sha256").update(`eureka-local:${workspaceId}`).digest("hex");
    profile = { schemaVersion: 1, workspaceId, ownerKey };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    localAutomationPath(base, file);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(profile) + "\n", { flag: "wx", mode: 0o600 });
    try {
      // Publish a complete file without replacing another process's profile.
      try { linkSync(temporary, file); }
      catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        profile = readLocalAutomationJson(base, file, 4096) as LocalAutomationProfile;
      }
    } finally { unlinkSync(temporary); }
  }
  if (profile?.schemaVersion !== 1 || !uuidPattern.test(profile.workspaceId) || !ownerPattern.test(profile.ownerKey)) throw new AutomationAppError("本地自动化工作区登记损坏，请恢复登记文件", 409);
  const assertIdentity = () => {
    const current = readLocalAutomationJson(base, file, 4096) as LocalAutomationProfile;
    if (current.workspaceId !== profile.workspaceId || current.ownerKey !== profile.ownerKey) throw new AutomationAppError("本地自动化工作区已变化，请重新打开", 409);
  };
  return { ...profile, runtimeId: profile.workspaceId, issuer: "eureka-local", subject: profile.workspaceId, assertIdentity };
}

export function assertLocalAutomationNamespace(ownerKey: string, base = getAgentDir()) {
  const context = localAutomationContext(base);
  if (!ownerPattern.test(ownerKey) || ownerKey !== context.ownerKey && !localAutomationNamespaces(base).includes(ownerKey)) throw new AutomationAppError("本地自动化数据目录不存在", 409);
  context.assertIdentity();
  return { ...context, ownerKey };
}

export function localAutomationTaskOwner(taskId: string, base = getAgentDir()) {
  if(!uuidPattern.test(taskId))throw new AutomationAppError("本地任务 ID 无效",400);
  const context=localAutomationContext(base),found:string[]=[];
  for(const owner of new Set([context.ownerKey,...localAutomationNamespaces(base)])){
    try{const task=readLocalAutomationJson(base,join(base,"app-data",owner,"creation",taskId,"task.json")) as {task?:{id:string;ownerKey:string}};if(task.task?.id!==taskId||task.task.ownerKey!==owner)throw new AutomationAppError("本地任务登记冲突",409);found.push(owner);}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  }
  if(found.length>1)throw new AutomationAppError("不同旧目录存在同 ID 任务，原记录均已保留",409);
  return found[0]??context.ownerKey;
}
