"use client";

import { useI18n } from "@/hooks/useI18n";
import type { AgentPhase } from "@/hooks/useAgentSession";

export function AgentActivityIndicator() {
  return <span className="agent-activity-indicator" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
  </span>;
}

export function ThinkingActivityIndicator() {
  return <span className="thinking-activity-indicator" aria-hidden="true">
    {Array.from({ length: 8 }, (_, index) => <i key={index} style={{ transform: "rotate(" + (index / 8) * 360 + "deg) translateY(-4.5px)" }}>
      <b style={{ animationDelay: (index / 8) * 1.5 + "s" }} />
    </i>)}
  </span>;
}

export function AgentActivityStatus({ phase }: { phase?: AgentPhase }) {
  const { t } = useI18n();
  if (!phase) return null;
  const waiting = phase.kind === "waiting_model";
  return <span className="agent-activity-label" aria-live="polite">
    {waiting && <AgentActivityIndicator />}
    <span className="agent-activity-text">{t(waiting ? "chat.waitingModel" : "taskPhase.running")}</span>
  </span>;
}
