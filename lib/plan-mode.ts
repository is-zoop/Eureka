import type { SessionEntry } from "./types";

export const PLAN_MODE_READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const PLAN_MODE_QUESTION_TOOL = "request_user_input";

export type EurekaPlanPhase = "idle" | "planning" | "reviewing" | "executing";

export interface EurekaPlanAnnotation {
  id: string;
  blockIndex: number;
  quote: string;
  note: string;
  createdAt: string;
}

export interface EurekaPlanTodo {
  index: number;
  text: string;
  done: boolean;
}

export interface EurekaPlanQuestionOption {
  id: string;
  label: string;
  description: string;
}

export interface EurekaPlanQuestion {
  id: string;
  toolCallId: string;
  title: string;
  question: string;
  options: EurekaPlanQuestionOption[];
  status: "pending" | "answered";
  answer?: {
    optionId?: string;
    text: string;
    custom: boolean;
  };
  askedAt: string;
  answeredAt?: string;
}

export interface EurekaPlanState {
  phase: EurekaPlanPhase;
  revision: number;
  content: string;
  annotations: EurekaPlanAnnotation[];
  generalNote: string;
  todos: EurekaPlanTodo[];
  questions: EurekaPlanQuestion[];
  originalToolNames: string[];
  originalToolPreset: string | null;
  sourceEntryId: string | null;
  /** Set only after an explicit approval; lets the user switch back to execution safely. */
  approvedAt: string | null;
  /** Whether the composer is currently restricted to planning-only capabilities. */
  planModeActive: boolean;
  /** Stable identity for the plan currently being drafted, reviewed, or executed. */
  activePlanId: string | null;
  /** Earlier plans from this session. Snapshots never contain nested history. */
  plans: EurekaPlanState[];
  updatedAt: string;
}

export const EMPTY_PLAN_STATE: EurekaPlanState = {
  phase: "idle",
  revision: 0,
  content: "",
  annotations: [],
  generalNote: "",
  todos: [],
  questions: [],
  originalToolNames: [],
  originalToolPreset: null,
  sourceEntryId: null,
  approvedAt: null,
  planModeActive: false,
  activePlanId: null,
  plans: [],
  updatedAt: "",
};

export function planSnapshot(state: EurekaPlanState): EurekaPlanState {
  return { ...state, plans: [] };
}

export function getSessionPlans(state: EurekaPlanState): EurekaPlanState[] {
  const current = state.phase === "idle" || !state.activePlanId ? [] : [planSnapshot(state)];
  return [...state.plans, ...current];
}

export function parsePlanTodos(content: string): EurekaPlanTodo[] {
  const todos: EurekaPlanTodo[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    if (!match) continue;
    todos.push({ index: todos.length + 1, text: match[2].trim(), done: /x/i.test(match[1] ?? "") });
  }
  return todos;
}

/** A reviewable plan needs a goal, an actionable checklist, and verification. */
export function isReviewablePlan(content: string): boolean {
  const hasGoal = /(?:^|\n)#{1,6}\s*(?:目标|Goal)(?:\s|$)/im.test(content);
  const hasSteps = /(?:^|\n)#{1,6}\s*(?:实施(?:步骤|清单)?|实现(?:步骤|清单)?|Implementation steps?)(?:\s|$)/im.test(content)
    && /^\s*[-*+]\s+\[ \]\s+.+$/m.test(content);
  const hasVerification = /(?:^|\n)#{1,6}\s*(?:验证(?:方式)?|Verification)(?:\s|$)/im.test(content);
  return hasGoal && hasSteps && hasVerification;
}

export function markPlanTodosDone(todos: EurekaPlanTodo[], assistantText: string): EurekaPlanTodo[] {
  const completed = new Set(
    Array.from(assistantText.matchAll(/\[DONE:(\d+)\]/g), (match) => Number(match[1])),
  );
  if (completed.size === 0) return todos;
  return todos.map((todo) => completed.has(todo.index) ? { ...todo, done: true } : todo);
}

export function getPendingPlanQuestion(state: EurekaPlanState): EurekaPlanQuestion | null {
  if (!state.planModeActive) return null;
  for (let index = state.questions.length - 1; index >= 0; index -= 1) {
    if (state.questions[index]?.status === "pending") return state.questions[index];
  }
  return null;
}

function isPlanState(value: unknown): value is EurekaPlanState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<EurekaPlanState>;
  return ["idle", "planning", "reviewing", "executing"].includes(state.phase ?? "")
    && typeof state.revision === "number"
    && typeof state.content === "string"
    && Array.isArray(state.annotations)
    && Array.isArray(state.todos)
    && Array.isArray(state.originalToolNames);
}

export function readPlanState(entries: SessionEntry[]): EurekaPlanState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== "eureka_plan") continue;
    if (isPlanState(entry.data)) {
      const state: EurekaPlanState = {
        ...EMPTY_PLAN_STATE,
        ...entry.data,
        questions: Array.isArray(entry.data.questions) ? entry.data.questions : [],
        plans: Array.isArray(entry.data.plans) ? entry.data.plans.map((plan) => ({ ...EMPTY_PLAN_STATE, ...plan, plans: [] })) : [],
      };
      // Older sessions used a single plan object. Infer the new composer-mode
      // flag and stable record id so their review/execution UI remains usable.
      if (typeof (entry.data as Partial<EurekaPlanState>).planModeActive !== "boolean") {
        state.planModeActive = state.phase === "planning" || state.phase === "reviewing";
      }
      if (!state.activePlanId && state.phase !== "idle") {
        state.activePlanId = `legacy_${state.revision}_${state.sourceEntryId ?? "plan"}`;
      }
      // Sessions created before approvedAt existed can still resume an approved
      // plan after the user temporarily switched back to planning.
      if (!state.approvedAt && state.content) {
        for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
          const prior = entries[priorIndex];
          if (prior.type !== "custom" || prior.customType !== "eureka_plan" || !isPlanState(prior.data)) continue;
          if (prior.data.phase === "executing" && prior.data.content === state.content && prior.data.revision === state.revision) {
            state.approvedAt = prior.data.updatedAt || null;
            break;
          }
        }
      }
      return state;
    }
  }
  return EMPTY_PLAN_STATE;
}

export const PLAN_MODE_SYSTEM_PROMPT = `You are in Eureka planning mode. Explore and analyze only. You must not edit files, write files, run shell commands, install packages, invoke MCP/extension tools, commit, or otherwise change the workspace. Do not output implementation source code, complete scripts, patches, or commands that perform the task. First inspect the available context. If a material requirement is missing, call request_user_input exactly once with one question and 2–4 mutually exclusive options; never ask a clarification in normal text. If the information is sufficient, state your assumptions instead. Then provide one concise Markdown implementation plan only, with headings exactly equivalent to: Goal, Affected areas, Implementation steps, Risks, and Verification. Implementation steps must use unchecked checklist items (- [ ]). Do not start implementation until the user explicitly approves the submitted plan.`;

export const PLAN_EXECUTION_SYSTEM_PROMPT = `You are executing a native Eureka plan that the user explicitly approved. The approved plan is included below in this session context; it is not a PLAN.md, plan.md, TODO.md, or any other project file. Do not search for a plan document and do not invoke Plannotator planning commands. Implement the approved checklist in order. After completing a checklist item, include [DONE:n] in your response, where n is that item's 1-based number. If the approved plan is no longer sufficient, stop making changes and ask the user to return to planning mode.`;
