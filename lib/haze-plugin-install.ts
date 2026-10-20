import { createHash, randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "./auth/config";
import type { AuthSession } from "./auth/types";
import { downloadHazePackage } from "./haze-managed-capabilities";
import { parsePluginArchive, type PluginManifest } from "./haze-plugin-package";
import { pluginStorageRoot, readHazeRegistry, withHazeRegistryLock, writeHazeRegistry, type HazeManagedInstall, type HazeInstallScope } from "./haze-registry";
import { cleanupPluginDirectories } from "./haze-plugin-resources";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";

export class PluginInstallError extends Error { constructor(message: string, public status = 400) { super(message); } }
type Preparation = { source: string; subject: string; cwd: string; scope: HazeInstallScope; capabilityId: string; version: string; name: string; operation: "install" | "update"; expiresAt: number; digest: string; manifest: PluginManifest; root: string };
const TTL = 10 * 60_000;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function inspectArchive(archive: Buffer, version: string) {
  try { return parsePluginArchive(archive, version); }
  catch (error) { throw new PluginInstallError(error instanceof Error ? error.message : "插件包无效"); }
}
function identity(session: AuthSession) {
  const source = getAuthConfig()?.issuer.replace(/\/$/, "");
  if (!source || !session.principal.subject) throw new PluginInstallError("请先登录 Haze", 401);
  return { source, subject: session.principal.subject };
}
function isCurrent(item: HazeManagedInstall, id: string, source: string) { return item.type === "Plugin" && item.capabilityId === id && item.plugin?.source === source; }
async function storage(cwd: string, scope: HazeInstallScope) {
  const root = pluginStorageRoot(cwd, scope);
  await mkdir(root, { recursive: true });
  const base = realpathSync(scope === "global" ? getAgentDir() : cwd);
  if (!isPathWithinRoots(realpathSync(root), new Set([base]))) throw new PluginInstallError("插件存储目录越界");
  return root;
}
function preparationPath(root: string, token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new PluginInstallError("请重新准备插件安装", 409);
  return join(root, ".staging", hash(token));
}
async function cleanExpired(root: string) {
  const dir = join(root, ".staging");
  if (!existsSync(dir)) return;
  if (!isPathWithinRoots(realpathSync(dir), new Set([realpathSync(root)]))) throw new PluginInstallError("插件准备目录越界");
  for (const entry of await readdir(dir)) {
    if (!/^[a-f0-9]{64}$/.test(entry)) continue;
    const path = join(dir, entry);
    try { if (Date.now() - (await stat(path)).mtimeMs > TTL && isPathWithinRoots(realpathSync(path), new Set([realpathSync(dir)]))) await rm(path, { recursive: true, force: true }); } catch { /* Another preparation may have completed. */ }
  }
}
export async function prepareOrganizationPlugin(input: { cwd: string; scope: HazeInstallScope; capabilityId: string; name: string; version: string; operation: "install" | "update"; session: AuthSession; accessToken: string }) {
  const owner = identity(input.session);
  const previous = readHazeRegistry(input.cwd, input.scope).installs.find((item) => isCurrent(item, input.capabilityId, owner.source));
  if (input.operation === "install" && previous) throw new PluginInstallError("该范围已安装此插件", 409);
  if (input.operation === "update" && !previous) throw new PluginInstallError("该范围未安装此插件", 409);
  const archive = await downloadHazePackage(input.capabilityId, input.accessToken);
  const parsed = inspectArchive(archive, input.version);
  const root = await storage(input.cwd, input.scope);
  await mkdir(join(root, ".staging"), { recursive: true });
  await cleanExpired(root);
  const token = randomBytes(32).toString("hex"), stage = preparationPath(root, token);
  await mkdir(stage, { recursive: true });
  const preparation: Preparation = { ...owner, cwd: resolve(input.cwd), scope: input.scope, capabilityId: input.capabilityId, name: input.name, version: input.version, operation: input.operation, expiresAt: Date.now() + TTL, digest: hash(archive), manifest: parsed.manifest, root: stage };
  try {
    await writeFile(join(stage, "package.zip"), archive);
    await writeFile(join(stage, "preparation.json"), JSON.stringify(preparation));
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  const approved = previous?.plugin?.subject === owner.subject ? previous.plugin.approvedUrls : [];
  return { preparationToken: token, expiresAt: preparation.expiresAt, version: preparation.version, digest: preparation.digest, name: parsed.manifest.displayName, skills: parsed.manifest.skillDirectories, servers: parsed.manifest.servers, capabilities: parsed.manifest.capabilities, requiresApproval: parsed.manifest.servers.some((server) => server.auth && !approved.includes(server.url)) };
}
export async function commitOrganizationPlugin(input: { cwd: string; scope: HazeInstallScope; capabilityId: string; version: string; operation: "install" | "update"; session: AuthSession; preparationToken: unknown; approveAddresses: unknown }) {
  const owner = identity(input.session), root = await storage(input.cwd, input.scope);
  return withHazeRegistryLock(input.cwd, input.scope, async () => {
    const stage = preparationPath(root, input.preparationToken);
    if (existsSync(stage) && !isPathWithinRoots(realpathSync(stage), new Set([realpathSync(root)]))) throw new PluginInstallError("插件准备目录越界");
    let prepared: Preparation;
    try { prepared = JSON.parse(await readFile(join(stage, "preparation.json"), "utf8")); } catch { throw new PluginInstallError("准备已失效，请重新准备插件安装", 409); }
    if (prepared.expiresAt < Date.now() || prepared.source !== owner.source || prepared.subject !== owner.subject || !samePath(prepared.cwd, input.cwd) || prepared.scope !== input.scope || prepared.capabilityId !== input.capabilityId || prepared.version !== input.version || prepared.operation !== input.operation) throw new PluginInstallError("身份、版本或安装范围发生变化，请重新准备", 409);
    const archive = await readFile(join(stage, "package.zip"));
    if (hash(archive) !== prepared.digest) throw new PluginInstallError("准备包内容发生变化，请重新准备", 409);
    const parsed = inspectArchive(archive, prepared.version);
    const registry = readHazeRegistry(input.cwd, input.scope);
    const previous = registry.installs.find((item) => isCurrent(item, input.capabilityId, owner.source));
    if ((input.operation === "install") === Boolean(previous)) throw new PluginInstallError("安装状态发生变化，请重新准备", 409);
    const needed = parsed.manifest.servers.filter((server) => server.auth).map((server) => server.url);
    const existingApproval = previous?.plugin?.subject === owner.subject ? previous.plugin.approvedUrls : [];
    if (needed.some((url) => !existingApproval.includes(url)) && input.approveAddresses !== true) throw new PluginInstallError("请确认插件的 MCP 服务地址", 409);
    const parent = join(root, hash(owner.source).slice(0, 16), input.capabilityId);
    await mkdir(parent, { recursive: true });
    if (!isPathWithinRoots(realpathSync(parent), new Set([realpathSync(root)]))) throw new PluginInstallError("插件安装目录越界");
    const extracted = await mkdtemp(join(parent, ".installing-"));
    // Each installation gets an immutable directory; running sessions retain their old resources.
    const target = join(parent, `${prepared.digest}-${randomBytes(6).toString("hex")}`);
    try {
      for (const [file, content] of parsed.files) {
        const destination = resolve(extracted, ...file.split("/"));
        if (!isPathWithinRoots(destination, new Set([extracted]))) throw new PluginInstallError("插件文件路径越界");
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
      await rename(extracted, target);
      const install: HazeManagedInstall = { capabilityId: input.capabilityId, name: prepared.name, type: "Plugin", version: prepared.version, scope: input.scope, installedAt: new Date().toISOString(), disabled: previous?.disabled, lifecycle: previous?.lifecycle ?? "lazy", idleTimeout: previous?.idleTimeout ?? 10, plugin: { ...owner, digest: prepared.digest, root: target, manifest: parsed.manifest, approvedUrls: needed } };
      registry.installs = [...registry.installs.filter((item) => !isCurrent(item, input.capabilityId, owner.source)), install];
      if (input.scope === "project") new ProjectTrustStore(getAgentDir()).set(input.cwd, true);
      await writeHazeRegistry(input.cwd, input.scope, registry);
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      await cleanupPluginDirectories(input.cwd, input.scope).catch(() => { /* Retry unused-directory cleanup on the next lifecycle event. */ });
      return install;
    } catch (error) {
      await rm(extracted, { recursive: true, force: true });
      if (!readHazeRegistry(input.cwd, input.scope).installs.some((item) => item.plugin && samePath(item.plugin.root, target))) await rm(target, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function mutateOrganizationPlugin(cwd: string, scope: HazeInstallScope, id: string, session: AuthSession, action: "uninstall" | "set-disabled", disabled?: boolean) {
  const owner = identity(session);
  await storage(cwd, scope);
  return withHazeRegistryLock(cwd, scope, async () => {
    const registry = readHazeRegistry(cwd, scope), item = registry.installs.find((record) => isCurrent(record, id, owner.source));
    if (!item) throw new PluginInstallError("找不到此插件", 404);
    if (action === "uninstall") registry.installs = registry.installs.filter((record) => record !== item);
    else item.disabled = disabled;
    await writeHazeRegistry(cwd, scope, registry);
    await cleanupPluginDirectories(cwd, scope).catch(() => { /* Registration is committed; deferred cleanup must not undo a successful action. */ });
  });
}
