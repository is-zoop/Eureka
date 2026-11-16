import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createMcpExtension, createCodemodeExtension, createToolSearchExtension, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StdioTransport, StreamableHttpTransport, type McpFetch, type McpTransport } from "@earendil-works/pi-mcp";
import { getHazeNativeMcpBinding, clearHazeNativeMcpBindings } from "./haze-native-mcp-bindings";
import { HazeMcpAuthError, resolveHazeNativeMcpHeaders } from "./haze-native-mcp-auth";
import { persistentPluginSelectionError } from "./plugin-selection-runtime";
import { isSessionPromptSuppressed } from "./session-prompt-policy";
import { clarificationRuntime } from "./clarification-runtime";
import { readPlanState } from "./plan-mode";

export const NATIVE_MCP_STATUS_EVENT = "eureka:mcp-status/v1";
type Options = NonNullable<Parameters<typeof createMcpExtension>[0]>;
type ServerStatus = { name: string; status: string; toolCount: number; directToolCount?: number; resourceCount?: number; disabled?: boolean };
const protectedMethods = new Set(["tools/call", "resources/list", "resources/templates/list", "resources/read", "prompts/get", "prompts/list"]);

declare global { var __eurekaNativeMcpDisposals: WeakMap<object, { sessionId: string; dispose(clearBinding: boolean): void }> | undefined; }
const disposals = globalThis.__eurekaNativeMcpDisposals ??= new WeakMap<object, { sessionId: string; dispose(clearBinding: boolean): void }>();

/** AgentSession.dispose() does not emit session_shutdown; fork mutates the manager's id first. */
export function disposeNativeMcpRuntime(manager: object): string | undefined {
  const runtime = disposals.get(manager);
  runtime?.dispose(true);
  return runtime?.sessionId;
}

function envValue(value: string): string {
  if (value.startsWith("!")) throw new Error("Eureka 原生 MCP 请使用环境变量引用配置凭证，暂不执行命令形式的配置值。");
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|^\$([A-Za-z_][A-Za-z0-9_]*)$/g, (_match, first, second, third) => {
    const name = first ?? second ?? third;
    if (process.env[name] === undefined) throw new Error(`MCP 环境变量未设置：${name}`);
    return process.env[name]!;
  });
}
function expandHome(value: string): string { return value === "~" ? homedir() : /^~[\\/]/.test(value) ? join(homedir(), value.slice(2)) : value; }
function address(value: string | URL): string { const url = new URL(value); url.hash = ""; return url.href; }

/** Public SDK extension and transports; Haze credentials are resolved at the final HTTP boundary. */
export function installNativeMcpRuntime(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  let generation = 0;
  const statuses = new Map<string, ServerStatus>();
  const transports = new Set<McpTransport>();
  let stop: (() => void) | undefined;
  const publish = () => pi.events.emit(NATIVE_MCP_STATUS_EVENT, { servers: [...statuses.values()] });
  pi.on("session_start", (_event, ctx) => {
    disposals.get(ctx.sessionManager)?.dispose(false);
    context = ctx; generation++; statuses.clear();
    const sessionId = ctx.sessionManager.getSessionId();
    const cleanup = (clearBinding: boolean) => {
      generation++; context = undefined; statuses.clear();
      if (disposals.get(ctx.sessionManager)?.dispose === cleanup) disposals.delete(ctx.sessionManager);
      if (clearBinding) clearHazeNativeMcpBindings(sessionId);
      for (const transport of transports) void transport.close().catch(() => {});
      transports.clear();
    };
    disposals.set(ctx.sessionManager, { sessionId, dispose: cleanup });
    stop = () => cleanup(false);
    for (const server of pi.getMcpServers()) statuses.set(server.name, { name: server.name, status: server.config.enabled === false ? "disabled" : "not-connected", disabled: server.config.enabled === false, toolCount: 0 });
    publish();
  });
  pi.on("session_shutdown", () => { stop?.(); stop = undefined; });
  const createTransport: NonNullable<Options["createTransport"]> = (entry, cwd, authProvider) => {
    const ctx = context;
    if (!ctx) throw new Error("MCP 会话尚未启动。");
    const activeGeneration = generation;
    const binding = getHazeNativeMcpBinding(ctx.sessionManager.getSessionId(), entry.name);
    const setState = (status: string, extra: Partial<ServerStatus> = {}) => {
      if (generation !== activeGeneration) return;
      statuses.set(entry.name, { name: entry.name, toolCount: 0, ...statuses.get(entry.name), status, ...extra }); publish();
    };
    const assertCurrent = async () => {
      if (generation !== activeGeneration || context !== ctx) throw new Error("MCP 会话已关闭或重载。");
      if (binding) {
        if (getHazeNativeMcpBinding(ctx.sessionManager.getSessionId(), entry.name) !== binding || !("url" in entry.config) || address(entry.config.url) !== address(binding.url)) throw new Error("Haze MCP 登记或地址已变化，请重载会话。");
        try { await binding.validate(); }
        catch (error) { setState(error instanceof HazeMcpAuthError ? "needs-auth" : "failed"); throw error; }
      }
    };
    const assertAllowed = () => {
      if (!binding) return;
      const plan = readPlanState(ctx.sessionManager.getEntries() as Parameters<typeof readPlanState>[0]);
      if (isSessionPromptSuppressed(ctx.sessionManager) || !pi.getActiveTools().length || (plan.planModeActive && ["planning", "reviewing"].includes(plan.phase))) throw new Error("当前工具权限不允许调用 Haze MCP。");
      const error = persistentPluginSelectionError(ctx, entry.name);
      if (error) throw new Error(error);
    };
    const monitor = <T extends McpTransport>(transport: T): T => {
      transports.add(transport);
      const pending = new Map<string | number, { method: string; firstPage: boolean }>();
      const send = transport.send.bind(transport);
      transport.send = (message, options) => {
        if ("method" in message && "id" in message && message.id !== undefined && message.id !== null && ["tools/list", "resources/list"].includes(message.method)) {
          pending.set(message.id, { method: message.method, firstPage: !(message.params as { cursor?: unknown } | undefined)?.cursor });
        }
        return send(message, options);
      };
      const remove = transport.onMessage((message) => {
        if (!("id" in message) || message.id === null || message.id === undefined) return;
        const request = pending.get(message.id); pending.delete(message.id);
        if (!request || !("result" in message) || !message.result || typeof message.result !== "object") return;
        const result = message.result as { tools?: unknown[]; resources?: unknown[]; nextCursor?: unknown };
        if (request.method === "tools/list" && Array.isArray(result.tools)) setState("connected", { toolCount: result.tools.length, directToolCount: entry.config.exposure === "direct" && !entry.config.toolExposure ? result.tools.length : undefined });
        if (request.method === "resources/list" && request.firstPage && !result.nextCursor && Array.isArray(result.resources)) setState("connected", { resourceCount: result.resources.length });
      });
      const removeError = transport.onError((error) => {
        if (statuses.get(entry.name)?.status !== "needs-auth") setState(error instanceof HazeMcpAuthError ? "needs-auth" : "failed");
      });
      transport.onClose(() => {
        transports.delete(transport);
        remove(); removeError(); pending.clear();
        if (statuses.get(entry.name)?.status === "connected") setState("not-connected");
      });
      return transport;
    };
    setState("not-connected");
    if (!("url" in entry.config)) {
      return monitor(new StdioTransport({ command: expandHome(entry.config.command), args: entry.config.args?.map(expandHome), cwd: resolve(cwd, expandHome(entry.config.cwd ?? ".")), env: Object.fromEntries(Object.entries(entry.config.env ?? {}).map(([key, value]) => [key, envValue(value)])), stderr: "pipe" }));
    }
    const headers = binding ? {} : Object.fromEntries(Object.entries(entry.config.headers ?? {}).map(([key, value]) => [key, envValue(value)]));
    const request: McpFetch = async (input, init = {}) => {
      let method: string | undefined;
      try { if (typeof init.body === "string") method = (JSON.parse(init.body) as { method?: string }).method; } catch { /* GET or protocol response */ }
      const protectedCall = method !== undefined && protectedMethods.has(method);
      const taskId = protectedCall ? clarificationRuntime(ctx.sessionManager)?.task?.id : undefined;
      const check = async () => {
        init.signal?.throwIfAborted(); await assertCurrent();
        if (protectedCall) {
          assertAllowed();
          if (clarificationRuntime(ctx.sessionManager)?.task?.id !== taskId) throw new Error("MCP 请求所属任务已变化。");
        }
      };
      try {
        await check();
        if (binding && address(input) !== address(binding.url)) throw new Error("MCP 请求地址未经授权。");
        const outbound = new Headers(init.headers);
        if (binding) {
          outbound.delete("Authorization");
          if (binding.authenticated) {
            if (!binding.identity) throw new HazeMcpAuthError("请登录 Haze 并重载会话。");
            const currentHeaders = await resolveHazeNativeMcpHeaders(binding.identity, init.signal);
            for (const [key, value] of Object.entries(currentHeaders)) outbound.set(key, value);
          }
        }
        await check();
        let response: Response;
        try { response = await fetch(input, { ...init, headers: outbound, ...(binding ? { redirect: "manual" as const } : {}) }); }
        catch (error) { if (init.signal?.aborted) throw error; setState("failed"); throw new Error("MCP 网络连接失败，请检查服务地址与网络。"); }
        await check();
        if (binding && response.status >= 300 && response.status < 400) {
          await response.body?.cancel(); throw new Error("Haze MCP 不允许重定向到未授权地址。");
        }
        if (binding && response.body) {
          const reader = response.body.getReader();
          response = new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const chunk = await reader.read(); await check();
                if (chunk.done) controller.close(); else controller.enqueue(chunk.value);
              } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
            },
            cancel: (reason) => reader.cancel(reason),
          }), { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        if (!response.ok) {
          setState(response.status === 401 || response.status === 403 ? "needs-auth" : "failed");
          if (binding) { await response.body?.cancel(); return new Response("Haze MCP request failed", { status: response.status }); }
        }
        return response;
      } catch (error) {
        if (error instanceof HazeMcpAuthError) setState("needs-auth");
        throw error;
      }
    };
    return monitor(new StreamableHttpTransport({ url: entry.config.url, headers, fetch: request, authProvider: binding ? undefined : authProvider }));
  };
  createCodemodeExtension({ models: false })(pi);
  createToolSearchExtension()(pi);
  createMcpExtension({ createTransport })(pi);
}
