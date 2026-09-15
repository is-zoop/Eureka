import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { McpConfigScope, McpServerInput, McpServerSummary } from "./api-types";

type RawConfig = { mcpServers?: Record<string, Record<string, unknown>>; [key: string]: unknown };
const variable = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$env:[A-Za-z_][A-Za-z0-9_]*)$/;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function mcpConfigPath(cwd: string, scope: McpConfigScope) { return scope === "project" ? join(cwd, ".mcp.json") : join(homedir(), ".config", "mcp", "mcp.json"); }

async function readConfig(path: string): Promise<{ config: RawConfig; diagnostics: string[] }> {
  if (!existsSync(path)) return { config: { mcpServers: {} }, diagnostics: [] };
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as RawConfig;
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("root must be an object");
    return { config: { ...value, mcpServers: value.mcpServers && typeof value.mcpServers === "object" ? value.mcpServers : {} }, diagnostics: [] };
  } catch (error) { return { config: { mcpServers: {} }, diagnostics: [`无法解析 ${path}: ${error instanceof Error ? error.message : String(error)}`] }; }
}

function cleanMap(value: unknown, label: string, sensitive = false): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} 必须是键值对象`);
  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== "string") throw new Error(`${label}.${key} 必须是字符串`);
    if (sensitive && (/authorization|token|secret|password|api[-_]?key/i.test(key)) && !variable.test(raw)) throw new Error(`${label}.${key} 必须使用环境变量引用`);
    result[key] = raw;
  }
  return result;
}

export function validateMcpServer(value: McpServerInput): McpServerInput {
  const name = value.name?.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error("Server 名称只能包含字母、数字、点、下划线和连字符");
  const lifecycle = value.lifecycle ?? "lazy";
  if (!["lazy", "eager", "keep-alive"].includes(lifecycle)) throw new Error("无效的生命周期");
  const idleTimeout = value.idleTimeout ?? 10;
  if (!Number.isFinite(idleTimeout) || idleTimeout < 1 || idleTimeout > 1440) throw new Error("空闲断开时间必须为 1–1440 分钟");
  if (value.transport === "stdio") {
    if (!value.command?.trim()) throw new Error("Stdio Server 必须提供命令");
    if (value.args && !Array.isArray(value.args) || value.args?.some((item) => typeof item !== "string")) throw new Error("参数必须是字符串数组");
    return { name, transport: "stdio", command: value.command.trim(), ...(value.args?.length ? { args: value.args } : {}), ...(value.cwd?.trim() ? { cwd: value.cwd.trim() } : {}), ...(cleanMap(value.env, "env") ? { env: cleanMap(value.env, "env") } : {}), lifecycle, idleTimeout, ...(value.disabled ? { disabled: true } : {}) };
  }
  if (value.transport !== "http") throw new Error("不支持的传输方式");
  try { const url = new URL(value.url ?? ""); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { throw new Error("HTTP Server 必须提供合法的 http(s) URL"); }
  if (value.bearerTokenEnv && !envName.test(value.bearerTokenEnv)) throw new Error("Bearer Token 必须填写环境变量名");
  return { name, transport: "http", url: value.url!.trim(), ...(cleanMap(value.headers, "headers", true) ? { headers: cleanMap(value.headers, "headers", true) } : {}), ...(value.bearerTokenEnv ? { bearerTokenEnv: value.bearerTokenEnv } : {}), lifecycle, idleTimeout, ...(value.disabled ? { disabled: true } : {}) };
}

function summary(name: string, entry: Record<string, unknown>, scope: McpConfigScope): McpServerSummary {
  const isHttp = typeof entry.url === "string";
  return { name, scope, transport: isHttp ? "http" : "stdio", ...(isHttp ? { url: entry.url as string, headers: entry.headers as Record<string, string> | undefined, bearerTokenEnv: entry.bearerTokenEnv as string | undefined } : { command: entry.command as string | undefined, args: Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === "string") : undefined, cwd: entry.cwd as string | undefined, env: entry.env as Record<string, string> | undefined }), lifecycle: (entry.lifecycle as McpServerSummary["lifecycle"]) ?? "lazy", idleTimeout: typeof entry.idleTimeout === "number" ? entry.idleTimeout : 10, ...(entry.disabled === true ? { disabled: true } : {}), state: "unknown", toolCount: 0 };
}

export async function listMcpServers(cwd: string, scope: McpConfigScope) {
  const path = mcpConfigPath(cwd, scope); const { config, diagnostics } = await readConfig(path);
  return { scope, configPath: path, diagnostics, servers: Object.entries(config.mcpServers ?? {}).map(([name, entry]) => summary(name, entry, scope)) };
}

export async function mutateMcpServers(cwd: string, scope: McpConfigScope, action: "create" | "update" | "delete" | "set-disabled", server?: McpServerInput, previousName?: string, disabled?: boolean) {
  const path = mcpConfigPath(cwd, scope); const { config, diagnostics } = await readConfig(path);
  if (diagnostics.length) throw new Error(diagnostics[0]);
  const servers = { ...(config.mcpServers ?? {}) };
  if (action === "delete") { if (!previousName || !servers[previousName]) throw new Error("找不到要删除的 Server"); delete servers[previousName]; }
  else if (action === "set-disabled") {
    if (!previousName || !servers[previousName]) throw new Error("找不到要更新的 Server");
    const { disabled: _disabled, ...entry } = servers[previousName];
    servers[previousName] = disabled ? { ...entry, disabled: true } : entry;
  }
  else {
    if (!server) throw new Error("缺少 Server 配置"); const normalized = validateMcpServer(server);
    if (action === "create" && servers[normalized.name]) throw new Error("同名 Server 已存在");
    if (action === "update" && (!previousName || !servers[previousName])) throw new Error("找不到要更新的 Server");
    if (previousName && previousName !== normalized.name) { if (servers[normalized.name]) throw new Error("同名 Server 已存在"); delete servers[previousName]; }
    const { name, transport, bearerTokenEnv, ...rest } = normalized;
    servers[name] = transport === "http"
      ? { ...rest, ...(bearerTokenEnv ? { auth: "bearer", bearerTokenEnv } : {}) }
      : rest;
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`, "utf8"); await rename(temp, path);
  return listMcpServers(cwd, scope);
}
