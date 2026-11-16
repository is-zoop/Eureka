import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "path";
import type { McpConfigScope, McpServerInput, McpServerSummary } from "./api-types";

type RawConfig = { mcpServers?: Record<string, Record<string, unknown>>; [key: string]: unknown };
const variable = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$env:[A-Za-z_][A-Za-z0-9_]*)$/;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function mcpConfigPath(cwd: string, scope: McpConfigScope) { return scope === "project" ? join(cwd, ".pi", "mcp.json") : join(getAgentDir(), "mcp.json"); }

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
    if (sensitive && (/authorization|token|secret|password|api[-_]?key/i.test(key)) && !variable.test(raw.replace(/^Bearer\s+/i, ""))) throw new Error(`${label}.${key} 必须使用环境变量引用`);
    result[key] = raw;
  }
  return result;
}

export function validateMcpServer(value: McpServerInput): McpServerInput {
  const exposures = ["direct", "deferred", "codemode", "hidden"];
  if (value.exposure !== undefined && !exposures.includes(value.exposure)) throw new Error("工具提供方式无效");
  if (value.toolExposure !== undefined && (!value.toolExposure || typeof value.toolExposure !== "object" || Array.isArray(value.toolExposure) || Object.entries(value.toolExposure).some(([key, exposure]) => !key || !exposures.includes(exposure)))) throw new Error("单个工具的提供方式无效");
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 2000)) throw new Error("Server 描述不能超过 2000 字");
  const discovery = { ...(value.exposure !== undefined ? { exposure: value.exposure } : {}), ...(value.toolExposure !== undefined ? { toolExposure: value.toolExposure } : {}), ...(value.description !== undefined ? { description: value.description.trim() } : {}) };
  const name = value.name?.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error("Server 名称只能包含字母、数字、下划线和连字符");
  const timeout = value.timeout ?? 60;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600) throw new Error("请求超时必须为 1–600 秒");
  if (value.transport === "stdio") {
    if (!value.command?.trim()) throw new Error("Stdio Server 必须提供命令");
    if (value.args && !Array.isArray(value.args) || value.args?.some((item) => typeof item !== "string")) throw new Error("参数必须是字符串数组");
    return { name, transport: "stdio", command: value.command.trim(), ...(value.args?.length ? { args: value.args } : {}), ...(value.cwd?.trim() ? { cwd: value.cwd.trim() } : {}), ...(cleanMap(value.env, "env") ? { env: cleanMap(value.env, "env") } : {}), timeout, ...discovery, ...(value.disabled ? { disabled: true } : {}) };
  }
  if (value.transport !== "http") throw new Error("不支持的传输方式");
  try { const url = new URL(value.url ?? ""); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { throw new Error("HTTP Server 必须提供合法的 http(s) URL"); }
  if (value.bearerTokenEnv && !envName.test(value.bearerTokenEnv)) throw new Error("Bearer Token 必须填写环境变量名");
  return { name, transport: "http", url: value.url!.trim(), ...(cleanMap(value.headers, "headers", true) ? { headers: cleanMap(value.headers, "headers", true) } : {}), ...(value.bearerTokenEnv ? { bearerTokenEnv: value.bearerTokenEnv } : {}), timeout, ...discovery, ...(value.disabled ? { disabled: true } : {}) };
}

function summary(name: string, entry: Record<string, unknown>, scope: McpConfigScope): McpServerSummary {
  const isHttp = typeof entry.url === "string";
  return { name, scope, transport: isHttp ? "http" : "stdio", ...(isHttp ? { url: entry.url as string, headers: entry.headers as Record<string, string> | undefined, bearerTokenEnv: typeof (entry.headers as Record<string, unknown> | undefined)?.Authorization === "string" ? ((entry.headers as Record<string, string>).Authorization.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1]) : undefined } : { command: entry.command as string | undefined, args: Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === "string") : undefined, cwd: entry.cwd as string | undefined, env: entry.env as Record<string, string> | undefined }), timeout: typeof entry.timeout === "number" ? entry.timeout : 60, ...(entry.enabled === false ? { disabled: true } : {}), state: "unknown", toolCount: 0 };
}

export async function listMcpServers(cwd: string, scope: McpConfigScope) {
  const path = mcpConfigPath(cwd, scope); const { config, diagnostics } = await readConfig(path);
  return { scope, configPath: path, diagnostics, servers: Object.entries(config.mcpServers ?? {}).map(([name, entry]) => ({ ...summary(name, entry, scope), exposure: (entry.exposure === "codemode-deferred" ? "codemode" : entry.exposure ?? "codemode") as McpServerInput["exposure"], ...(typeof entry.description === "string" ? { description: entry.description } : {}) })) };
}

export async function mutateMcpServers(cwd: string, scope: McpConfigScope, action: "create" | "update" | "delete" | "set-disabled", server?: McpServerInput, previousName?: string, disabled?: boolean) {
  const path = mcpConfigPath(cwd, scope); const { config, diagnostics } = await readConfig(path);
  if (diagnostics.length) throw new Error(diagnostics[0]);
  const servers = { ...(config.mcpServers ?? {}) };
  if (action === "delete") { if (!previousName || !servers[previousName]) throw new Error("找不到要删除的 Server"); delete servers[previousName]; }
  else if (action === "set-disabled") {
    if (!previousName || !servers[previousName]) throw new Error("找不到要更新的 Server");
    servers[previousName] = { ...servers[previousName], enabled: !disabled };
  }
  else {
    if (!server) throw new Error("缺少 Server 配置"); const normalized = validateMcpServer(server);
    if (action === "create" && servers[normalized.name]) throw new Error("同名 Server 已存在");
    if (action === "update" && (!previousName || !servers[previousName])) throw new Error("找不到要更新的 Server");
    const previous = action === "update" && previousName ? { ...servers[previousName] } : {};
    if (previousName && previousName !== normalized.name) { if (servers[normalized.name]) throw new Error("同名 Server 已存在"); delete servers[previousName]; }
    const { name, transport, bearerTokenEnv, disabled, ...rest } = normalized;
    // Keep SDK options not edited by this form (OAuth, per-tool exposure, etc.).
    // Connection fields are replaced, so changing transport cannot retain a stale URL.
    for (const key of ["type", "command", "args", "cwd", "env", "url", "headers"]) delete previous[key];
    if (transport === "stdio") delete previous.oauth;
    servers[name] = { ...previous, ...rest, ...(rest.exposure === undefined && previous.exposure === undefined && action === "create" ? { exposure: "direct" } : {}), enabled: !disabled,
      ...(transport === "http" && bearerTokenEnv ? { headers: { ...rest.headers, Authorization: `Bearer \${${bearerTokenEnv}}` } } : {}) };
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`, "utf8"); await rename(temp, path);
  return listMcpServers(cwd, scope);
}
