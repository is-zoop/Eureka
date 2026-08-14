import type { ClientCommand, WebError, WebSessionSummary } from "@pi-web/protocol";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PiRuntimeManager } from "./runtime-manager.js";

export class PiSessionController {
  constructor(private readonly manager: PiRuntimeManager) {}
  async preflight(command: ClientCommand): Promise<WebError | undefined> {
    if ((command.type === "new_session" || command.type === "switch_session") && !this.manager.getSession().isIdle) return rejected("agent_busy", "Stop the agent before changing sessions.");
    if ((command.type === "set_model" || command.type === "set_thinking_level" || command.type === "compact") && !this.manager.getSession().isIdle) return rejected("agent_busy", "Stop the agent before changing this setting.");
    if (command.type === "set_model") {
      const available = await this.manager.getRuntime().services.modelRuntime.getAvailable();
      if (!available.some((model) => model.provider === command.provider && model.id === command.modelId)) return rejected("unknown_model", "Requested model is unavailable.");
    }
    if (command.type === "set_thinking_level" && !this.manager.getSession().getAvailableThinkingLevels().includes(command.level)) return rejected("unsupported_thinking_level", "Requested thinking level is unavailable for this model.");
    if (command.type === "switch_session") {
      const known = await SessionManager.list(this.manager.workspace);
      if (!known.some((item) => item.id === command.sessionId && item.cwd === this.manager.workspace)) return rejected("unknown_session", "Requested session does not belong to this workspace.");
    }
    return undefined;
  }
  async listSessions():Promise<WebSessionSummary[]>{return toWebSessionSummaries(await SessionManager.list(this.manager.workspace));}
  async dispatch(command: ClientCommand): Promise<WebError | undefined> {
    const session = this.manager.getSession();
    try {
      switch (command.type) {
        case "prompt": await session.prompt(command.text, command.images ? { images: command.images.map((image) => ({ type: "image", source: { type: "base64", mediaType: image.mimeType, data: image.data } })) } : undefined); return;
        case "abort": await session.abort(); return;
        case "compact": await session.compact(command.instructions); return;
        case "set_thinking_level": session.setThinkingLevel(command.level); return;
        case "set_model": { const model = this.manager.getRuntime().services.modelRuntime.getModel(command.provider, command.modelId); if (!model) return rejected("unknown_model", "Requested model is unavailable."); await session.setModel(model); return; }
        case "new_session": await this.manager.getRuntime().newSession(); this.manager.rebind(); return;
        case "list_sessions": return;
        case "switch_session": { const known = await SessionManager.list(this.manager.workspace); const target = known.find((item) => item.id === command.sessionId && item.cwd === this.manager.workspace); if (!target) return rejected("unknown_session", "Requested session does not belong to this workspace."); await this.manager.getRuntime().switchSession(target.path); this.manager.rebind(); return; }
      }
    } catch (cause) { console.error(cause); return rejected("command_failed", "The command could not be completed."); }
  }
}
export function toWebSessionSummaries(sessions: Array<{ id: string; name?: string; created: Date; modified: Date; messageCount: number; firstMessage: string }>): WebSessionSummary[] {
  return sessions.slice().sort((a, b) => b.modified.getTime() - a.modified.getTime()).map((session) => ({ id: session.id, ...(session.name ? { name: session.name } : {}), createdAt: session.created.getTime(), modifiedAt: session.modified.getTime(), messageCount: session.messageCount, preview: session.firstMessage }));
}
function rejected(code: string, message: string): WebError { return { code, message, recoverable: true }; }
