import { crc32, inflateRawSync } from "node:zlib";

export type PluginServer = { name: string; url: string; auth?: "haze-personal-credential" };
export type PluginManifest = { name: string; version: string; displayName: string; skillDirectories: string[]; servers: PluginServer[]; capabilities?: { requestUserInput?: boolean } };
export type PluginArchive = { manifest: PluginManifest; files: Map<string, Buffer> };

const MAX_ARCHIVE = 100 * 1024 * 1024;
const MAX_EXPANDED = 200 * 1024 * 1024;
function invalid(message: string): never { throw new Error(`插件包无效：${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("配置必须是 JSON 对象");
  return value as Record<string, unknown>;
}

export function pluginRelativePath(value: string): string {
  const path = value.replace(/^\.\//, "").replace(/\/$/, "");
  if (!path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) invalid("组件包含不安全路径");
  return path;
}

export function pluginServerUrl(value: unknown): string {
  if (typeof value !== "string") invalid("MCP 缺少服务地址");
  let url: URL;
  try { url = new URL(value); } catch { invalid("MCP 地址无效"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) invalid("MCP 必须使用 HTTPS 或本机回环 HTTP 地址，地址不得含凭证或查询参数");
  return url.href;
}

/** Bounded, non-executing ZIP reader shared by package validation and extraction. */
export function readPluginZip(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length > MAX_ARCHIVE) invalid("ZIP 超过 100 MiB");
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length) invalid("ZIP 结束记录损坏");
  const count = buffer.readUInt16LE(end + 10);
  if (!count || count > 10_000 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count) invalid("不支持多卷或空 ZIP");
  let cursor = buffer.readUInt32LE(end + 16);
  if (cursor + buffer.readUInt32LE(end + 12) !== end) invalid("ZIP 目录损坏");
  let expanded = 0;
  const seen = new Set<string>();
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) invalid("ZIP 目录损坏");
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16), packed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameSize = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const mode = buffer.readUInt32LE(cursor + 38) >>> 16, local = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameSize + extra + comment > end || flags & 1 || ![0, 8].includes(method) || ((mode & 0xf000) !== 0 && ![0x8000, 0x4000].includes(mode & 0xf000))) invalid("ZIP 包含加密条目、链接或不支持的文件");
    const raw = buffer.subarray(cursor + 46, cursor + 46 + nameSize).toString("utf8");
    const name = pluginRelativePath(raw);
    const key = name.toLowerCase();
    if (seen.has(key)) invalid("ZIP 包含重复路径");
    seen.add(key);
    cursor += 46 + nameSize + extra + comment;
    if (local + 30 > end || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) invalid("ZIP 条目损坏");
    const localNameSize = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28);
    const start = local + 30 + localNameSize + localExtra;
    if (start + packed > end || buffer.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== raw) invalid("ZIP 条目路径不一致");
    expanded += size;
    if (expanded > MAX_EXPANDED) invalid("解压后超过 200 MiB");
    if (raw.endsWith("/")) { if (size) invalid("ZIP 目录包含内容"); continue; }
    const data = buffer.subarray(start, start + packed);
    const content = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, size) });
    if (content.length !== size || crc32(content) !== expectedCrc) invalid("ZIP 内容校验失败");
    files.set(name, Buffer.from(content));
  }
  if (cursor !== end) invalid("ZIP 目录长度不一致");
  const fileNames = new Set([...files.keys()].map((name) => name.toLowerCase()));
  for (const name of files.keys()) {
    const parts = name.toLowerCase().split("/");
    for (let index = 1; index < parts.length; index++) if (fileNames.has(parts.slice(0, index).join("/"))) invalid("文件与目录路径冲突");
  }
  return files;
}

export function parsePluginArchive(buffer: Buffer, expectedVersion: string): PluginArchive {
  const entries = readPluginZip(buffer);
  const roots = [...entries.keys()].filter((name) => name === "plugin.json" || /^[^/]+\/plugin\.json$/.test(name));
  if (roots.length !== 1) invalid("必须包含一个 plugin.json 根清单，请使用 Eureka 版本插件");
  const prefix = roots[0].slice(0, -"plugin.json".length);
  if ([...entries.keys()].some((name) => !name.startsWith(prefix))) invalid("ZIP 包含插件根目录以外的文件");
  const files = new Map([...entries].map(([name, data]) => [name.slice(prefix.length), data]));
  const json = (path: string) => {
    const data = files.get(path);
    if (!data || data.length > 1024 * 1024) invalid(`缺少或过大的 ${path}`);
    try { return object(JSON.parse(data.toString("utf8"))); } catch { invalid(`${path} 格式错误`); }
  };
  const manifest = json("plugin.json"), pkg = json("package.json");
  if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" || typeof manifest.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.name)) invalid("插件名称或格式不支持");
  if (manifest.version !== expectedVersion || pkg.name !== manifest.name || pkg.version !== manifest.version) invalid("Haze、plugin.json 和 package.json 版本或名称不一致，请刷新后重试");
  const extensions = object(manifest.extensions), host = object(extensions["com.eureka"]);
  if (host.schemaVersion !== 1) invalid("需要 schemaVersion=1 的 Eureka 插件");
  const capabilities = host.capabilities === undefined ? {} : object(host.capabilities);
  if (Object.keys(capabilities).some((key) => key !== "requestUserInput") || (capabilities.requestUserInput !== undefined && typeof capabilities.requestUserInput !== "boolean")) invalid("不支持的宿主能力声明，requestUserInput 必须为布尔值");
  const pi = object(pkg.pi);
  if (Object.keys(pi).some((key) => key !== "skills") || ["hooks", "agents", "commands", "mcpServers", "skills"].some((key) => manifest[key] !== undefined) || pkg.scripts !== undefined || [...files.keys()].some((name) => /^(?:hooks\/|extensions\/|\.claude-plugin\/|\.codex-plugin\/)/.test(name))) invalid("首期仅支持 Skill 和 HTTP MCP，不支持脚本、hooks 或其他组件");
  if (!Array.isArray(pi.skills) || pi.skills.some((path) => typeof path !== "string")) invalid("pi.skills 必须是目录数组");
  const skillDirectories = pi.skills.map((path: string) => pluginRelativePath(path));
  for (const path of skillDirectories) if (![...files.keys()].some((file) => file.startsWith(`${path}/`) && /(?:^|\/)SKILL\.md$/.test(file))) invalid(`技能目录 ${path} 不存在`);
  const auth = host.auth === undefined ? {} : object(host.auth);
  const servers: PluginServer[] = [];
  if (files.has("mcp.json")) {
    const config = json("mcp.json");
    if (config.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" || Object.keys(config).some((key) => !["$schema", "mcpServers"].includes(key))) invalid("MCP 清单格式不支持");
    for (const [name, entry] of Object.entries(object(config.mcpServers))) {
      const server = object(entry);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name) || server.type !== "streamable-http" || Object.keys(server).some((key) => !["type", "url"].includes(key))) invalid("MCP 仅支持标准 Streamable HTTP type/url 配置");
      if (auth[name] !== undefined && object(auth[name]).provider !== "haze-personal-credential") invalid("不支持的认证提供者");
      servers.push({ name, url: pluginServerUrl(server.url), ...(auth[name] !== undefined ? { auth: "haze-personal-credential" as const } : {}) });
    }
  }
  if (Object.keys(auth).some((name) => !servers.some((server) => server.name === name))) invalid("认证声明引用不存在的 MCP");
  if (!skillDirectories.length && !servers.length) invalid("插件没有可加载组件");
  return { manifest: { name: manifest.name, version: expectedVersion, displayName: typeof host.displayName === "string" ? host.displayName : manifest.name, skillDirectories, servers, ...(host.capabilities !== undefined ? { capabilities: { requestUserInput: capabilities.requestUserInput === true } } : {}) }, files };
}
