import type { AgentMessage } from "./types";

export interface ChatAutomationAnchor { id: string; messageIndex: number; name: string }
const invocationId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Persisted results anchor a card; a later status check must not move it. */
export function chatAutomationAnchors(messages: AgentMessage[]): ChatAutomationAnchor[] {
  const seen = new Set<string>(), anchors: ChatAutomationAnchor[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "toolResult" || message.toolName !== "eureka_automation_run") return;
    let value = message.details as { invocationId?: unknown; name?: unknown } | undefined;
    if (!invocationId(value?.invocationId)) {
      try {
        value = JSON.parse(message.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
      } catch { return; }
    }
    if (!invocationId(value?.invocationId) || seen.has(value.invocationId)) return;
    seen.add(value.invocationId);
    anchors.push({ id: value.invocationId, messageIndex, name: typeof value.name === "string" ? value.name : "运行自动化" });
  });
  return anchors;
}

