import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "@/lib/auth/config";
import { refreshRuntimeHazeSession } from "@/lib/auth/runtime-session";

import { readHazeRegistry, writeHazeRegistry, withHazeRegistryLock, type HazeManagedInstall, type HazeInstallScope, type HazeCapabilityType, type HazeMcpRuntimeOptions } from "./haze-registry";
import { readPluginZip } from "./haze-plugin-package";
export type { HazeManagedInstall, HazeInstallScope, HazeCapabilityType, HazeMcpLifecycle, HazeMcpRuntimeOptions } from "./haze-registry";

export type HazeCapabilityInput = { id: string; name: string; slug?: string | null; type: HazeCapabilityType; version: string; serverUrl?: string | null; connectType?: string | null };

export function hazeMcpRuntimeOptions(lifecycle: unknown, idleTimeout: unknown): HazeMcpRuntimeOptions {
  if (lifecycle !== "lazy" && lifecycle !== "eager" && lifecycle !== "keep-alive") throw new Error("无效的生命周期");
  if (typeof idleTimeout !== "number" || !Number.isFinite(idleTimeout) || idleTimeout < 1 || idleTimeout > 1440) throw new Error("空闲断开时间必须为 1–1440 分钟");
  return { lifecycle, idleTimeout };
}

function storedMcpRuntimeOptions(record: Partial<HazeManagedInstall>): HazeMcpRuntimeOptions {
  try { return hazeMcpRuntimeOptions(record.lifecycle ?? "lazy", record.idleTimeout ?? 10); }
  catch { return { lifecycle: "lazy", idleTimeout: 10 }; }
}

function skillRoot(cwd: string, scope: HazeInstallScope) {
  return scope === "global" ? join(getAgentDir(), "skills") : join(cwd, ".pi", "skills");
}
const readRegistry = readHazeRegistry;
const writeRegistry = writeHazeRegistry;

export async function listHazeManagedInstalls(cwd: string) {
  const [global, project] = await Promise.all([readRegistry(cwd, "global"), readRegistry(cwd, "project")]);
  return { global: global.installs, project: project.installs };
}

export async function listEffectiveHazeManagedMcps(cwd: string) {
  const { global, project } = await listHazeManagedInstalls(cwd);
  const effective = new Map(global.filter((item) => item.type === "MCP").map((item) => [item.capabilityId, item]));
  for (const item of project) if (item.type === "MCP") effective.set(item.capabilityId, item);
  return [...effective.values()];
}

async function extractSkillZip(buffer: Buffer, target: string) {
  const files = readPluginZip(buffer);
  if (!files.has("SKILL.md")) throw new Error("Skill 包根目录必须包含 SKILL.md");
  await mkdir(target, { recursive: true });
  for (const [file, content] of files) {
    const destination = resolve(target, ...file.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

/** Mirrors the marketplace Skill toggle while keeping the Haze registry in sync. */
async function setSkillModelInvocationDisabled(cwd: string, scope: HazeInstallScope, install: HazeManagedInstall, disabled: boolean) {
  if (!install.skillPath) throw new Error("该 Skill 缺少安装目录");
  const root = resolve(skillRoot(cwd, scope));
  const directory = resolve(install.skillPath);
  const relativePath = relative(root, directory);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("Skill 安装目录无效");
  const skillFile = join(directory, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error("Skill 文件不存在");

  const content = await readFile(skillFile, "utf8");
  const key = "disable-model-invocation";
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const alreadyDisabled = Boolean(frontmatter[key]);
  let updated = content;
  if (disabled && !alreadyDisabled) {
    updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
    if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
  } else if (!disabled && alreadyDisabled) {
    updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
  }
  if (updated !== content) await writeFile(skillFile, updated, "utf8");
}

async function hazeAccessToken() {
  const config = getAuthConfig();
  const session = await refreshRuntimeHazeSession();
  if (!config || !session?.accessToken) throw new Error("请先登录 Haze 后再安装组织能力");
  return { config, accessToken: session.accessToken };
}

export async function downloadHazePackage(id: string, activeAccessToken?: string) {
  const config = getAuthConfig();
  if (!config) throw new Error("请先登录 Haze 后再安装组织能力");
  const accessToken = activeAccessToken ?? (await hazeAccessToken()).accessToken;
  // Haze's access-prompt endpoint is the OAuth-compatible way to issue the
  // five-minute Skill ZIP link. The lower-level download-link endpoint uses
  // the regular login-JWT dependency and rejects OAuth tokens by audience.
  const linkResponse = await fetch(`${config.issuer}/api/marketplace/capabilities/${encodeURIComponent(id)}/access-prompt`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
  const linkPayload = await linkResponse.json().catch(() => null) as { data?: { download_url?: unknown }; message?: unknown } | null;
  if (!linkResponse.ok || typeof linkPayload?.data?.download_url !== "string") throw new Error(typeof linkPayload?.message === "string" ? linkPayload.message : "无法获取 Skill 下载链接");
  const packageResponse = await fetch(linkPayload.data.download_url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!packageResponse.ok) throw new Error("Skill 下载链接已失效，请重试");
  if (!packageResponse.body) throw new Error("扩展下载内容为空");
  const reader = packageResponse.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100 * 1024 * 1024) throw new Error("扩展下载超过 100 MiB");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function installHazeCapabilityUnlocked(cwd: string, scope: HazeInstallScope, capability: HazeCapabilityInput, runtimeOptions?: HazeMcpRuntimeOptions, activeAccessToken?: string) {
  if (!/^\d+$/.test(capability.id)) throw new Error("无效的 Haze 能力 ID");
  if (capability.type === "Plugin") throw new Error("插件必须先准备并确认安装");
  const registry = await readRegistry(cwd, scope);
  const previous = registry.installs.find((item) => item.capabilityId === capability.id && item.type === capability.type);
  let install: HazeManagedInstall;
  if (capability.type === "Skill") {
    const slug = capability.slug?.trim();
    if (!slug || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug)) throw new Error("该 Skill 未提供有效的 slug，无法确定安装目录");
    const destination = join(skillRoot(cwd, scope), slug);
    const temporary = `${destination}.installing-${process.pid}-${Date.now()}`;
    await rm(temporary, { recursive: true, force: true });
    try {
      await extractSkillZip(await downloadHazePackage(capability.id, activeAccessToken), temporary);
      await rm(destination, { recursive: true, force: true });
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination);
      if (previous?.skillPath && resolve(previous.skillPath) !== resolve(destination)) await rm(previous.skillPath, { recursive: true, force: true });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    install = { capabilityId: capability.id, name: capability.name, type: "Skill", version: capability.version, scope, installedAt: new Date().toISOString(), skillPath: destination, disabled: previous?.disabled };
    if (install.disabled) await setSkillModelInvocationDisabled(cwd, scope, install, true);
  } else {
    if (capability.connectType?.toUpperCase() !== "HTTP" || !capability.serverUrl) throw new Error("该组织 MCP 未提供可用的 HTTP 服务地址");
    const runtime = runtimeOptions ?? storedMcpRuntimeOptions(previous ?? {});
    install = { capabilityId: capability.id, name: capability.name, type: "MCP", version: capability.version, scope, installedAt: new Date().toISOString(), serverUrl: capability.serverUrl, disabled: previous?.disabled, ...runtime };
  }
  registry.installs = [...registry.installs.filter((item) => !(item.capabilityId === capability.id && item.type === capability.type)), install];
  await writeRegistry(cwd, scope, registry);
  return install;
}

async function uninstallHazeCapabilityUnlocked(cwd: string, scope: HazeInstallScope, capabilityId: string, type: HazeCapabilityType) {
  const registry = await readRegistry(cwd, scope);
  const install = registry.installs.find((item) => item.capabilityId === capabilityId && item.type === type);
  if (!install) throw new Error("该范围未安装此能力");
  if (install.skillPath && existsSync(install.skillPath)) await rm(install.skillPath, { recursive: true, force: true });
  registry.installs = registry.installs.filter((item) => item !== install);
  await writeRegistry(cwd, scope, registry);
}

async function setHazeCapabilityDisabledUnlocked(cwd: string, scope: HazeInstallScope, capabilityId: string, type: HazeCapabilityType, disabled: boolean) {
  const registry = await readRegistry(cwd, scope);
  const install = registry.installs.find((item) => item.capabilityId === capabilityId && item.type === type);
  if (!install) throw new Error("该范围未安装此能力");
  if (type === "Skill") await setSkillModelInvocationDisabled(cwd, scope, install, disabled);
  install.disabled = disabled;
  await writeRegistry(cwd, scope, registry);
  return install;
}

async function configureHazeManagedMcpUnlocked(cwd: string, scope: HazeInstallScope, capabilityId: string, options: HazeMcpRuntimeOptions) {
  const registry = await readRegistry(cwd, scope);
  const install = registry.installs.find((item) => item.capabilityId === capabilityId && item.type === "MCP");
  if (!install) throw new Error("该范围未安装此 MCP");
  install.lifecycle = options.lifecycle;
  install.idleTimeout = options.idleTimeout;
  await writeRegistry(cwd, scope, registry);
  return install;
}

export async function installHazeCapability(cwd: string, scope: HazeInstallScope, capability: HazeCapabilityInput, runtimeOptions?: HazeMcpRuntimeOptions, activeAccessToken?: string) {
  return withHazeRegistryLock(cwd, scope, () => installHazeCapabilityUnlocked(cwd, scope, capability, runtimeOptions, activeAccessToken));
}

export async function uninstallHazeCapability(cwd: string, scope: HazeInstallScope, capabilityId: string, type: HazeCapabilityType) {
  return withHazeRegistryLock(cwd, scope, () => uninstallHazeCapabilityUnlocked(cwd, scope, capabilityId, type));
}

export async function setHazeCapabilityDisabled(cwd: string, scope: HazeInstallScope, capabilityId: string, type: HazeCapabilityType, disabled: boolean) {
  return withHazeRegistryLock(cwd, scope, () => setHazeCapabilityDisabledUnlocked(cwd, scope, capabilityId, type, disabled));
}

export async function configureHazeManagedMcp(cwd: string, scope: HazeInstallScope, capabilityId: string, options: HazeMcpRuntimeOptions) {
  return withHazeRegistryLock(cwd, scope, () => configureHazeManagedMcpUnlocked(cwd, scope, capabilityId, options));
}
