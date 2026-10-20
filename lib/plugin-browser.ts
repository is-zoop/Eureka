import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { effectivePlugins } from "./haze-registry";
import { getPluginSnapshots } from "./haze-plugin-resources";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { browserOwner, openBrowser, browserUrl } from "./browser-runtime";

type ToolResultEventResult = Pick<ToolResultEvent, "content" | "details" | "isError">;
type Result = { toolName?: string; toolCallId: string; isError: boolean; content: ToolResultEvent["content"]; details?: unknown };
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
/** Accept the direct MCP payload and Atlas's standard { data, request_id } envelope. */
function browserPayload(value: unknown) {
  const envelope = object(value);
  if (!envelope || envelope.error) return null;
  if (typeof envelope.browser_url === "string") return { envelope, payload: envelope, wrapped: false };
  const data = object(envelope.data);
  return typeof data?.browser_url === "string" ? { envelope, payload: data, wrapped: true } : null;
}
export async function handoffPluginBrowserResult(event: Result, cwd: string, sessionId: string, open = openBrowser) {
  const details = object(event.details);
  if (event.isError || details?.error || typeof details?.server !== "string") return;
  const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "");
  const identity = readRuntimeHazeSession();
  if (!source || !identity) return;
  const snapshot = getPluginSnapshots(sessionId).find((item) => item.source === source && item.servers.includes(details.server as string));
  const install = snapshot && effectivePlugins(cwd, source).find((item) => item.capabilityId === snapshot.capabilityId && !item.disabled && item.plugin?.subject === identity.principal.subject);
  if (!install) return;
  const mcpResult = object(details.mcpResult);
  if (mcpResult?.isError) return;
  let extracted = browserPayload(mcpResult?.structuredContent);
  if (!extracted) {
    for (const block of event.content) {
      if (block.type !== "text" || typeof block.text !== "string" || block.text.length > 256_000) continue;
      try { extracted = browserPayload(JSON.parse(block.text)); if (extracted) break; } catch {}
    }
  }
  if (!extracted) return;
  const { payload } = extracted;
  const safe = { ...payload };
  delete safe.browser_url;
  let panel: { status: string; tabId?: string; message: string };
  try {
    const opened = await open(browserOwner(source, identity.principal.subject), sessionId, browserUrl(payload.browser_url), `${source}/${install.capabilityId}/${typeof payload.session_id === "string" ? payload.session_id : details.tool}`);
    panel = { status: "opened", tabId: opened.tabId, message: "Eureka 已在当前对话右侧浏览器打开页面。不要再调用系统浏览器或转发启动链接。" };
  } catch {
    panel = { status: "failed", message: "右侧浏览器打开失败。请检查 Chromium 安装与目标服务，再重新调用原工具获取新链接重试；不要声称已打开。" };
  }
  // Rebuild the result instead of persisting an expiring bearer launch URL in details.
  const replacement = extracted.wrapped
    ? { ...extracted.envelope, data: { ...safe, browser_panel: panel } }
    : { ...safe, browser_panel: panel };
  let replaced = false;
  const content = event.content.map((block) => {
    if (block.type !== "text" || block.text.length > 256_000) return block;
    try {
      const candidate = browserPayload(JSON.parse(block.text));
      if (candidate?.payload.browser_url === payload.browser_url) {
        replaced = true;
        return { type: "text" as const, text: JSON.stringify(replacement) };
      }
    } catch {}
    return block;
  });
  if (!replaced) content.push({ type: "text", text: JSON.stringify(replacement) });
  return { content, details: { server: details.server, tool: details.tool, browserPanel: panel }, isError: panel.status === "failed" };
}
export function installPluginBrowserHandoff(pi: ExtensionAPI, open = openBrowser) {
  const processed = new Map<string, Promise<ToolResultEventResult | undefined>>();
  pi.on("session_shutdown", () => { processed.clear(); });
  pi.on("tool_result", async (event, context) => {
    const existing = processed.get(event.toolCallId);
    if (existing) return existing;
    const pending = handoffPluginBrowserResult(event as unknown as Result, context.cwd, context.sessionManager.getSessionId(), open);
    processed.set(event.toolCallId, pending);
    const result = await pending;
    if (!result) processed.delete(event.toolCallId);
    return result as undefined | { content: typeof event.content; details: unknown; isError: boolean };
  });
}
