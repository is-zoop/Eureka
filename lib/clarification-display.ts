import { clarificationContinuationText, type ClarificationGroup } from "./clarification";
import { splitPluginSelection } from "./plugin-selection";
import type { AgentMessage, ToolResultMessage } from "./types";

/** Match persisted host continuations to their preceding, answered tool call.
 * Ordinary user messages (including similar prose) remain conversation anchors.
 * This also supports histories written before continuation presentation changed.
 */
export function clarificationContinuationIndices(messages: AgentMessage[], groups: ClarificationGroup[]): Set<number> {
  const summaries = new Map<string, string[]>();
  for (const group of groups) {
    if (group.status !== "answered") continue;
    const text = clarificationContinuationText(group);
    summaries.set(text, [...(summaries.get(text) ?? []), group.id]);
  }
  const encountered = new Set<string>();
  const hidden = new Set<number>();
  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall" && block.toolName === "request_user_input") encountered.add(block.toolCallId);
      }
    } else if (message.role === "user") {
      const text = typeof message.content === "string" ? message.content
        : message.content.every((block) => block.type === "text") ? message.content.map((block) => block.text).join("\n") : "";
      const ids = summaries.get(splitPluginSelection(text).text.trim());
      if (ids?.some((id) => encountered.has(id))) hidden.add(index);
      else encountered.clear();
    }
  });
  return hidden;
}

/** Presentation-only overlay: retain the real execution result and durable state. */
export function clarificationToolResult(group: ClarificationGroup, original: ToolResultMessage, labels: {
  waiting: string; skipped: string; cancelled: string;
}): ToolResultMessage {
  if (original.isError) return original;
  const text = group.questions.map((question) => `${question.question}\n${group.status === "cancelled" ? labels.cancelled
    : group.status === "pending" ? labels.waiting : question.answer?.skipped ? labels.skipped : question.answer?.text ?? labels.waiting}`).join("\n\n");
  return { ...original, content: [{ type: "text", text }], details: {
    ...(original.details && typeof original.details === "object" ? original.details : {}), eurekaClarification: true,
    eurekaClarificationSummary: group.questions.map((question) => `${question.title}：${group.status === "cancelled" ? labels.cancelled
      : group.status === "pending" ? labels.waiting : question.answer?.skipped ? labels.skipped : question.answer?.text ?? labels.waiting}`).join(" · ").slice(0, 300),
  } };
}
