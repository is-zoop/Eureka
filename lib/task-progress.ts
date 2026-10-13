import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { readPlanState } from "./plan-mode";
import type { SessionEntry } from "./types";

export const TASK_PROGRESS_INSTRUCTIONS = `[EUREKA TASK PROGRESS]
When using tools to carry out a task, briefly tell the user what you are about to do before starting each distinct work stage. Use one short natural-language progress update in the user's language, then carry out the related tool calls. Group related actions together; do not narrate every tool call or repeat the same update. When moving to a new work stage, report the relevant confirmed result and the next concrete action. Keep these updates separate from the final answer. Do not expose private reasoning or invent results. For simple conversational answers, omit work-stage narration. Follow the native planning/review format when it applies.`;

export function taskProgressSystemPrompt(base: string, hasTools: boolean, planPhase?: string): string | undefined {
  if (!hasTools || planPhase === "planning" || planPhase === "reviewing" || base.includes("[EUREKA TASK PROGRESS]")) return undefined;
  return base + "\n\n" + TASK_PROGRESS_INSTRUCTIONS;
}

export const EUREKA_TASK_PROGRESS_EXTENSION: InlineExtension = {
  name: "eureka-task-progress",
  hidden: true,
  factory: (pi) => {
    pi.on("before_agent_start", (event, ctx) => {
      const state = readPlanState(ctx.sessionManager.getEntries() as SessionEntry[]);
      const systemPrompt = taskProgressSystemPrompt(event.systemPrompt, pi.getActiveTools().length > 0, state.phase);
      return systemPrompt === undefined ? undefined : { systemPrompt };
    });
  },
};
