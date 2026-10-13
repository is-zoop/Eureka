"use client";

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ToolResultMessage } from "@/lib/types";
import type { TaskPhase, TaskTurnStatus, TaskTurnView as TaskTurnData } from "@/lib/task-phases";
import { ProcessBlockView } from "./MessageView";
import { AgentActivityIndicator } from "./AgentActivity";
import type { AgentPhase } from "@/hooks/useAgentSession";

export function phaseExpanded(status: TaskTurnStatus, choice?: { status: TaskTurnStatus; expanded: boolean }): boolean {
  return choice?.status === status ? choice.expanded : status !== "completed";
}

function PhaseArrow({ expanded }: { expanded: boolean }) {
  return <span className="task-phase-leading" aria-hidden="true"><span className="task-phase-arrow">
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "block", transform: expanded ? "rotate(90deg)" : undefined }}>
      <polyline points="4.5 3 7.5 6 4.5 9" />
    </svg>
  </span></span>;
}

export function TaskTurnView({ turn, toolResults, runningToolIds, agentPhase, cwd, onOpenFile, sessionId, modelNames, phaseRef, renderExtras }: {
  turn: TaskTurnData;
  toolResults: Map<string, ToolResultMessage>;
  runningToolIds?: ReadonlySet<string>;
  agentPhase?: AgentPhase;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  sessionId?: string;
  modelNames?: Record<string, string>;
  phaseRef?: (phase: TaskPhase) => Ref<HTMLDivElement> | undefined;
  renderExtras?: (phase: TaskPhase) => ReactNode;
}) {
  const { t } = useI18n();
  const [outerChoice, setOuterChoice] = useState<{ status: TaskTurnStatus; expanded: boolean }>();
  const [choices, setChoices] = useState<Record<string, { status: TaskTurnStatus; expanded: boolean }>>({});
  const statusSignature = turn.phases.map((phase) => phase.id + ":" + phase.status).join("|");
  useEffect(() => {
    setChoices((current) => Object.fromEntries(Object.entries(current).filter(([id, choice]) => turn.phases.some((phase) => phase.id === id && phase.status === choice.status))));
  // Counts and token deltas should not reset a user's explicit fold choice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusSignature]);
  useEffect(() => { setOuterChoice(undefined); }, [turn.status]);
  const completed = turn.status === "completed";
  const outerExpanded = !completed || phaseExpanded(turn.status, outerChoice);
  const toolCallCount = turn.phases.reduce((count, phase) => count + phase.toolCallCount, 0);
  const common = { toolResults, runningToolIds, cwd, onOpenFile, sessionId, modelNames };

  return <div className="task-turn-view" data-status={turn.status}>
    {completed && turn.phases.length > 0 && <button type="button" className="task-phase-toggle" aria-expanded={outerExpanded}
      onClick={() => setOuterChoice({ status: turn.status, expanded: !outerExpanded })}>
      <PhaseArrow expanded={outerExpanded} />
      <span className="task-phase-heading">
        <span>{t("chat.processDetails")}</span>
        <span className="task-phase-count">· {t("taskPhase.stageCount", { count: turn.phases.length })}</span>
        {toolCallCount > 0 && <span className="task-phase-count">· {t("taskPhase.toolCount", { count: toolCallCount })}</span>}
      </span>
    </button>}
    {!completed && turn.status !== "running" && <p className="task-turn-status" role={turn.status === "failed" ? "alert" : "status"}>{t("taskPhase." + turn.status)}</p>}
    {outerExpanded && turn.phases.map((phase, phaseIndex) => {
      const expanded = phaseExpanded(phase.status, choices[phase.id]);
      const running = phase.status === "running";
      const waiting = running && phaseIndex === turn.phases.length - 1 && agentPhase?.kind === "waiting_model";
      return <div className="task-phase" data-status={phase.status} key={phase.id} ref={phaseRef?.(phase)}>
        <div className="task-phase-description">
          {phase.summary.length > 0 ? phase.summary.map((ref) => <ProcessBlockView key={(ref.source.entryId ?? ref.source.messageIndex) + ":" + ref.blockIndex} reference={ref} {...common} />)
            : <p>{t(phase.fallbackKey)}</p>}
        </div>
        <button type="button" className="task-phase-toggle" aria-expanded={expanded}
          onClick={() => setChoices((current) => ({ ...current, [phase.id]: { status: phase.status, expanded: !expanded } }))}>
          <PhaseArrow expanded={expanded} />
          <span className="task-phase-heading">
            <span className="task-phase-status">{waiting ? <><AgentActivityIndicator /><span className="task-phase-status-text">{t("chat.waitingModel")}</span></> : t("taskPhase." + phase.status)}</span>
            {phase.toolCallCount > 0 && <span className="task-phase-count">· {t("taskPhase.toolCount", { count: phase.toolCallCount })}</span>}
            {phase.thinkingCount > 0 && <span className="task-phase-count">· {t("taskPhase.thinkingCount", { count: phase.thinkingCount })}</span>}
          </span>
        </button>
        {expanded && <div className="task-phase-body">
          {phase.items.map((ref) => <ProcessBlockView key={(ref.source.entryId ?? ref.source.messageIndex) + ":" + ref.blockIndex} reference={ref} {...common} />)}
          {renderExtras?.(phase)}
        </div>}
      </div>;
    })}
  </div>;
}
