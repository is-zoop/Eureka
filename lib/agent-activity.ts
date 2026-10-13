import type { AgentPhase } from "../hooks/useAgentSession";

/** Message delivery must not clear tools still executing in parallel. */
export function preserveRunningToolActivity(previous: AgentPhase, next: AgentPhase): AgentPhase {
  return previous?.kind === "running_tools" && previous.tools.length > 0 ? previous : next;
}
