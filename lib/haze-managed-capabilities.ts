import { inflateRawSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAuthConfig } from "@/lib/auth/config";
import { getIdentityProvider } from "@/lib/auth/provider";
import { readRuntimeHazeSession, writeRuntimeHazeSession } from "@/lib/auth/runtime-session";
import type { AuthSession } from "@/lib/auth/types";

export type HazeInstallScope = "global" | "project";
export type HazeCapabilityType = "Skill" | "MCP";

export type HazeManagedInstall = {
  capabilityId: string;
  name: string;
  type: HazeCapabilityType;
  version: string;
  scope: HazeInstallScope;
  installedAt: string;
  disabled?: boolean;
  skillPath?: string;
  serverUrl?: string;
};

type Registry = { version: 1; installs: HazeManagedInstall[] };
export type HazeCapabilityInput = { id: string; name: string; slug?: string | null; type: HazeCapabilityType; version: string; serverUrl?: string | null; connectType?: string | null };

function registryPath(cwd: string, scope: HazeInstallScope) {
  return scope === "global"
    ? join(getAgentDir(), "eureka-haze-capabilities.json")
    : join(cwd, ".pi", "eureka-haze-capabilities.json");
}

function skillRoot(cwd: string, scope: HazeInstallScope) {
  return scope === "global" ? join(getAgentDir(), "skills") : join(cwd, ".pi", "skills");
}

async function readRegistry(cwd: string, scope: HazeInstallScope): Promise<Registry> {
  try {
    const value = JSON.parse(await readFile(registryPath(cwd, scope), "utf8")) as { version?: unknown; installs?: unknown };
    if (value?.version === 1 && Array.isArray(value.installs)) {
      const installs = value.installs.flatMap((item): HazeManagedInstall[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Partial<HazeManagedInstall>;
        if (typeof record.capabilityId !== "string" || typeof record.name !== "string" || (record.type !== "Skill" && record.type !== "MCP") || typeof record.version !== "string" || (record.scope !== "global" && record.scope !== "project") || typeof record.installedAt !== "string") return [];
        return [{ capabilityId: record.capabilityId, name: record.name, type: record.type, version: record.version, scope: record.scope, installedAt: record.installedAt, disabled: record.disabled === true || undefined, skillPath: typeof record.skillPath === "string" ? record.skillPath : undefined, serverUrl: typeof record.serverUrl === "string" ? record.serverUrl : undefined }];
      });
      return { version: 1, installs };
    }
  } catch { /* missing or corrupt registry behaves as empty */ }
  return { version: 1, installs: [] };
}

async function writeRegistry(cwd: string, scope: HazeInstallScope, registry: Registry) {
  const path = registryPath(cwd, scope);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

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

function readU16(buffer: Buffer, offset: number) { return buffer.readUInt16LE(offset); }
function readU32(buffer: Buffer, offset: number) { return buffer.readUInt32LE(offset); }

/** Extract the ordinary ZIP formats emitted by Haze, rejecting unsafe paths. */
async function extractSkillZip(buffer: Buffer, target: string) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error("Skill ZIP 文件无效");
  const entries = readU16(buffer, end + 10);
  if (entries > 10_000 || buffer.length > 100 * 1024 * 1024) throw new Error("Skill ZIP 文件过大");
  const centralOffset = readU32(buffer, end + 16);
  let cursor = centralOffset;
  let expandedSize = 0;
  const files: Array<{ path: string; content: Buffer }> = [];
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > buffer.length) throw new Error("Skill ZIP 目录无效");
    if (readU32(buffer, cursor) !== 0x02014b50) throw new Error("Skill ZIP 目录无效");
    const method = readU16(buffer, cursor + 10);
    const compressedSize = readU32(buffer, cursor + 20);
    const uncompressedSize = readU32(buffer, cursor + 24);
    const nameLength = readU16(buffer, cursor + 28);
    const extraLength = readU16(buffer, cursor + 30);
    const commentLength = readU16(buffer, cursor + 32);
    const localOffset = readU32(buffer, cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > buffer.length) throw new Error("Skill ZIP 目录无效");
    const entryName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!entryName || entryName.endsWith("/")) continue;
    expandedSize += uncompressedSize;
    if (expandedSize > 200 * 1024 * 1024) throw new Error("Skill ZIP 解压后过大");
    if (entryName.startsWith("/") || entryName.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Skill ZIP 包含不安全路径");
    if (localOffset + 30 > buffer.length || readU32(buffer, localOffset) !== 0x04034b50) throw new Error("Skill ZIP 条目无效");
    const localNameLength = readU16(buffer, localOffset + 26);
    const localExtraLength = readU16(buffer, localOffset + 28);
    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    if (contentStart + compressedSize > buffer.length) throw new Error("Skill ZIP 条目无效");
    const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : (() => { throw new Error("Skill ZIP 使用了不支持的压缩格式"); })();
    files.push({ path: entryName, content });
  }
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error("Skill 包根目录必须包含 SKILL.md");
  await mkdir(target, { recursive: true });
  for (const file of files) {
    const destination = resolve(target, ...file.path.split("/"));
    if (relative(target, destination).startsWith(`..${sep}`) || relative(target, destination) === "..") throw new Error("Skill ZIP 包含不安全路径");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
}

async function hazeAccessToken() {
  const config = getAuthConfig();
  const session = readRuntimeHazeSession();
  const provider = getIdentityProvider();
  if (!config || !session || !provider) throw new Error("请先登录 Haze 后再安装组织能力");
  const tokens = await provider.refresh(session.refreshToken);
  const principal = await provider.userInfo(tokens.accessToken);
  const refreshed: AuthSession = { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000, principal };
  writeRuntimeHazeSession(refreshed);
  return { config, accessToken: tokens.accessToken };
}

async function downloadSkill(id: string, activeAccessToken?: string) {
  const config = getAuthConfig();
  if (!config) throw new Error("请先登录 Haze 后再安装组织能力");
  const accessToken = activeAccessToken ?? (await hazeAccessToken()).accessToken;
  // Haze's access-prompt endpoint is the OAuth-compatible way to issue the
  // five-minute Skill ZIP link. The lower-level download-link endpoint uses
  // the regular login-JWT dependency and rejects OAuth tokens by audience.
  const linkResponse = await fetch(`${config.issuer}/api/marketplace/capabilities/${encodeURIComponent(id)}/access-prompt`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
  const linkPayload = await linkResponse.json().catch(() => null) as { data?: { download_url?: unknown }; message?: unknown } | null;
  if (!linkResponse.ok || typeof linkPayload?.data?.download_url !== "string") throw new Error(typeof linkPayload?.message === "string" ? linkPayload.message : "无法获取 Skill 下载链接");
  const packageResponse = await fetch(linkPayload.data.download_url, { cache: "no-store" });
  if (!packageResponse.ok) throw new Error("Skill 下载链接已失效，请重试");
  return Buffer.from(await packageResponse.arrayBuffer());
}

export async function installHazeCapability(cwd: string, scope: HazeInstallScope, capability: HazeCapabilityInput, activeAccessToken?: string) {
  if (!/^\d+$/.test(capability.id)) throw new Error("无效的 Haze 能力 ID");
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
      await extractSkillZip(await downloadSkill(capability.id, activeAccessToken), temporary);
      await rm(destination, { recursive: true, force: true });
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporary, destination);
      if (previous?.skillPath && resolve(previous.skillPath) !== resolve(destination)) await rm(previous.skillPath, { recursive: true, force: true });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    install = { capabilityId: capability.id, name: capability.name, type: "Skill", version: capability.version, scope, installedAt: new Date().toISOString(), skillPath: destination };
  } else {
    if (capability.connectType?.toUpperCase() !== "HTTP" || !capability.serverUrl) throw new Error("该组织 MCP 未提供可用的 HTTP 服务地址");
    install = { capabilityId: capability.id, name: capability.name, type: "MCP", version: capability.version, scope, installedAt: new Date().toISOString(), serverUrl: capability.serverUrl, disabled: previous?.disabled };
  }
  registry.installs = [...registry.installs.filter((item) => !(item.capabilityId === capability.id && item.type === capability.type)), install];
  await writeRegistry(cwd, scope, registry);
  return install;
}

export async function uninstallHazeCapability(cwd: string, scope: HazeInstallScope, capabilityId: string, type: HazeCapabilityType) {
  const registry = await readRegistry(cwd, scope);
  const install = registry.installs.find((item) => item.capabilityId === capabilityId && item.type === type);
  if (!install) throw new Error("该范围未安装此能力");
  if (install.skillPath && existsSync(install.skillPath)) await rm(install.skillPath, { recursive: true, force: true });
  registry.installs = registry.installs.filter((item) => item !== install);
  await writeRegistry(cwd, scope, registry);
}

export async function setHazeMcpDisabled(cwd: string, scope: HazeInstallScope, capabilityId: string, disabled: boolean) {
  const registry = await readRegistry(cwd, scope);
  const install = registry.installs.find((item) => item.capabilityId === capabilityId && item.type === "MCP");
  if (!install) throw new Error("该范围未安装此 MCP");
  install.disabled = disabled;
  await writeRegistry(cwd, scope, registry);
  return install;
}
