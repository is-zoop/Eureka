import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { effectivePlugins } from "./haze-registry";
import { getPluginSnapshots, installedPluginComposer, type PluginSnapshot } from "./haze-plugin-resources";
import { clarificationRuntime } from "./clarification-runtime";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { getProjectTrustStatus } from "./project-trust";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isPathWithinRoots } from "./path-security";

/** Resolve actual adapter server ownership; never infer it from tool-name prefixes. */
export function persistentPluginSelectionError(context: Pick<ExtensionContext, "cwd" | "sessionManager">, serverName: string): string | undefined {
  const loaded = getPluginSnapshots(context.sessionManager.getSessionId()).find((p) => p.servers.includes(serverName));
  if (!loaded) return;
  return selectionError(context, loaded);
}
function selectionError(context: Pick<ExtensionContext, "cwd" | "sessionManager">, loaded: PluginSnapshot): string | undefined {
  const install = effectivePlugins(context.cwd, loaded.source).find((p) => p.capabilityId === loaded.capabilityId);
  if (!install || install.disabled || loaded.error || install.plugin?.digest !== loaded.digest) return "插件已更改或停用，请检查安装并重载会话";
  let persistent = loaded.composer?.selectionMode === "persistent";
  try { if (install) persistent ||= installedPluginComposer(context.cwd, install).selectionMode === "persistent"; }
  catch { return "插件清单无法读取，请检查安装并重载会话"; }
  if (!persistent) return;
  const denied = "请先在输入框中选择此插件；已移除的插件不能用于后续任务";
  const identity = readRuntimeHazeSession();
  if (!identity || process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "") !== loaded.source || install?.plugin?.subject !== identity.principal.subject) return "插件身份已变化，请重新登录并选择插件";
  if (install.scope === "project" && !getProjectTrustStatus(context.cwd, getAgentDir()).trusted) return "项目插件尚未受信任";
  const task = clarificationRuntime(context.sessionManager)?.task;
  if (task?.owner && (task.owner.source !== loaded.source || task.owner.subject !== identity.principal.subject)) return "当前任务的插件身份已变化";
  if (!task?.plugins.some((p) => p.source === loaded.source && p.capabilityId === loaded.capabilityId && p.digest === loaded.digest)) return denied;
  return undefined;
}

export function installPluginSelectionRuntime(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  pi.on("session_start", (_event, ctx) => { context = ctx; });
  const unsubscribe = pi.events.on("pi-mcp-adapter:tool-approval-request", (value: unknown) => {
    const request = value as { serverName?: string; claim?: (handler: () => "deny" | "abstain") => boolean } | undefined;
    if (!context || typeof request?.serverName !== "string" || typeof request.claim !== "function") return;
    // All proxy/direct/script/resource calls reach the adapter's approval broker,
    // even when ordinary MCP approvals are disabled or were cached previously.
    try { if (!pi.getActiveTools().length || persistentPluginSelectionError(context, request.serverName)) request.claim(() => "deny"); }
    catch { request.claim(() => "deny"); }
  });
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "read") return;
    const input = event.input as Record<string, unknown>;
    const path = input.path ?? input.file_path;
    if (typeof path !== "string") return;
    const file = resolve(ctx.cwd, path);
    for (const plugin of getPluginSnapshots(ctx.sessionManager.getSessionId())) {
      if (!isPathWithinRoots(file, new Set([plugin.root]))) continue;
      try { const error = selectionError(ctx, plugin); if (error) return { block: true, reason: error }; }
      catch { return { block: true, reason: "插件状态已变化，请重载会话" }; }
    }
  });
  pi.on("before_agent_start", (_event, ctx) => {
    const persistent = effectivePlugins(ctx.cwd).filter((item) => {
      try { return installedPluginComposer(ctx.cwd, item).selectionMode === "persistent"; } catch { return false; }
    });
    if (!persistent.length || !pi.getActiveTools().length) return;
    const selected = clarificationRuntime(ctx.sessionManager)?.task?.plugins ?? [];
    return { message: { customType: "eureka-plugin-selection-framing", display: false,
      content: `[EUREKA PLUGIN SELECTION — THIS TASK ONLY]\n${persistent.map((item) => `${item.name}: ${selected.some((p) => p.source === item.plugin!.source && p.capabilityId === item.capabilityId && p.digest === item.plugin!.digest) ? "SELECTED" : "NOT SELECTED"}`).join("\n")}\nUse only selected persistent plugins. Earlier plugin instructions do not authorize unselected plugins, their skills, MCP tools or host capabilities. If needed, ask the user to select the plugin in the composer. Do not reuse its earlier rules after deselection. Existing conversation facts may still be used. Other tool permissions remain unchanged.` } };
  });
  pi.on("session_shutdown", () => { context = undefined; unsubscribe(); });
}
