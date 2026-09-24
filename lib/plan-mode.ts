import type { SessionEntry } from "./types";

export const PLAN_MODE_READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const PLAN_MODE_QUESTION_TOOL = "request_user_input";
/** Internal-only tool used to persist one completed approved-plan task. */
export const PLAN_MODE_COMPLETE_TOOL = "mark_plan_done";

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

export type EurekaPlanQuestionSelection = "single" | "multiple";

export interface EurekaPlanQuestionAnswer {
  /** Kept for compatibility with sessions created before multi-select support. */
  optionId?: string;
  optionIds?: string[];
  text: string;
  custom: boolean;
  skipped?: boolean;
}

export interface EurekaPlanQuestionResponse {
  questionId: string;
  optionIds?: string[];
  customAnswer?: string;
  skipped?: boolean;
}

export interface EurekaPlanQuestion {
  id: string;
  toolCallId: string;
  title: string;
  question: string;
  options: EurekaPlanQuestionOption[];
  /** Missing on historical entries means the original single-choice behavior. */
  selection?: EurekaPlanQuestionSelection;
  status: "pending" | "answered";
  answer?: EurekaPlanQuestionAnswer;
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
  /**
   * The last chat message that existed when this draft was started.  It keeps
   * historical assistant replies from being mistaken for a newly drafted plan.
   */
  draftBoundaryEntryId: string | null;
  /** Distinguishes a newly recorded empty-session boundary from legacy state. */
  draftBoundaryRecorded: boolean;
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
  draftBoundaryEntryId: null,
  draftBoundaryRecorded: false,
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

/**
 * A temporary plan card may only be rendered for an assistant reply produced
 * after plan mode was enabled. Persisted plans use sourceEntryId separately.
 */
export function isDraftPlanEntry(state: EurekaPlanState, entryIds: readonly string[], messageIndex: number): boolean {
  if (!state.draftBoundaryRecorded || messageIndex < 0 || !entryIds[messageIndex]) return false;
  if (state.draftBoundaryEntryId === null) return true;
  const boundaryIndex = entryIds.lastIndexOf(state.draftBoundaryEntryId);
  // Pi can prune older entries from the rendered context after compaction. Once
  // the recorded boundary is outside that context, every displayed entry belongs
  // to the post-boundary tail, so it must remain eligible for plan rendering.
  if (boundaryIndex < 0) return true;
  return messageIndex > boundaryIndex;
}

export function parsePlanTodos(content: string): EurekaPlanTodo[] {
  const todos: EurekaPlanTodo[] = [];
  let inExecutableSection = false;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = heading[1].trim().replace(/[：:]$/, "");
      inExecutableSection = /^(?:实施(?:步骤|清单)?|实现(?:步骤|清单)?|implementation steps?|验证(?:方式)?|verification)$/i.test(title);
      continue;
    }
    if (!inExecutableSection) continue;
    // A plan may contain bullets for affected areas and risks.  Those describe
    // context, not work the agent can complete, so only explicit task-list
    // items from executable sections become progress entries.
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
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
  const hasVerification = /(?:^|\n)#{1,6}\s*(?:验证(?:方式)?|Verification)(?:\s|$)/im.test(content)
    && /^\s*[-*+]\s+\[ \]\s+.+$/m.test(content.slice(content.search(/(?:^|\n)#{1,6}\s*(?:验证(?:方式)?|Verification)(?:\s|$)/im)));
  return hasGoal && hasSteps && hasVerification;
}

export function getPlanDoneIndexes(assistantText: string): number[] {
  return [...new Set(
    Array.from(assistantText.matchAll(/\[DONE:(\d+)\]/g), (match) => Number(match[1])),
  )].sort((a, b) => a - b);
}

export function markPlanTodosDone(todos: EurekaPlanTodo[], assistantText: string): EurekaPlanTodo[] {
  const completed = new Set(getPlanDoneIndexes(assistantText));
  if (completed.size === 0) return todos;
  return todos.map((todo) => completed.has(todo.index) ? { ...todo, done: true } : todo);
}

function normalizeStoredPlanTodos(state: EurekaPlanState): EurekaPlanState {
  const normalizeOne = (plan: EurekaPlanState): EurekaPlanState => {
    const parsed = parsePlanTodos(plan.content);
    if (parsed.length === 0) return plan;
    const completedTexts = new Set(plan.todos.filter((todo) => todo.done).map((todo) => todo.text));
    return {
      ...plan,
      todos: parsed.map((todo) => ({ ...todo, done: todo.done || completedTexts.has(todo.text) })),
    };
  };
  const current = normalizeOne(state);
  return {
    ...current,
    plans: current.plans.map((plan) => normalizeOne(plan)),
  };
}

function normalizeStoredPlanQuestions(state: EurekaPlanState): EurekaPlanState {
  const normalizeOne = (question: EurekaPlanQuestion): EurekaPlanQuestion => {
    const answer = question.answer;
    if (!answer) return { ...question, selection: question.selection === "multiple" ? "multiple" : "single" };
    const optionIds = getPlanQuestionOptionIds(answer);
    return {
      ...question,
      selection: question.selection === "multiple" ? "multiple" : "single",
      answer: {
        ...answer,
        optionIds,
        optionId: optionIds.length === 1 ? optionIds[0] : undefined,
        skipped: Boolean(answer.skipped),
      },
    };
  };
  return {
    ...state,
    questions: state.questions.map(normalizeOne),
    plans: state.plans.map((plan) => ({ ...plan, questions: plan.questions.map(normalizeOne) })),
  };
}

export function getPendingPlanQuestion(state: EurekaPlanState): EurekaPlanQuestion | null {
  if (!state.planModeActive) return null;
  for (let index = state.questions.length - 1; index >= 0; index -= 1) {
    if (state.questions[index]?.status === "pending") return state.questions[index];
  }
  return null;
}

/** All unanswered questions emitted by the same request_user_input tool call. */
export function getPendingPlanQuestionGroup(state: EurekaPlanState): EurekaPlanQuestion[] {
  const pending = getPendingPlanQuestion(state);
  if (!pending) return [];
  return state.questions.filter((question) => question.status === "pending" && question.toolCallId === pending.toolCallId);
}

export function getPlanQuestionOptionIds(answer?: EurekaPlanQuestionAnswer): string[] {
  if (!answer) return [];
  if (Array.isArray(answer.optionIds)) return answer.optionIds;
  return answer.optionId ? [answer.optionId] : [];
}

/** Validates one answer before a whole question group is persisted atomically. */
export function validatePlanQuestionResponse(
  question: EurekaPlanQuestion,
  response: EurekaPlanQuestionResponse,
): EurekaPlanQuestionAnswer {
  const optionIds = Array.isArray(response.optionIds)
    ? [...new Set(response.optionIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const customAnswer = typeof response.customAnswer === "string" ? response.customAnswer.trim() : "";
  if (response.skipped === true) {
    if (optionIds.length > 0 || customAnswer) throw new Error("A skipped question cannot also include an answer");
    return { optionIds: [], text: "Skipped", custom: false, skipped: true };
  }
  if (customAnswer) {
    if (optionIds.length > 0) throw new Error("A custom answer cannot be combined with selected options");
    return { optionIds: [], text: customAnswer, custom: true, skipped: false };
  }
  if (optionIds.length === 0) throw new Error("Choose an option, provide a custom answer, or skip the question");
  if ((question.selection ?? "single") === "single" && optionIds.length !== 1) throw new Error("This question accepts exactly one option");
  const selectedOptions = optionIds.map((id) => question.options.find((option) => option.id === id));
  if (selectedOptions.some((option) => !option)) throw new Error("The selected option is not available for this question");
  return {
    optionId: optionIds.length === 1 ? optionIds[0] : undefined,
    optionIds,
    text: selectedOptions.map((option) => option!.label).join("、"),
    custom: false,
    skipped: false,
  };
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

/**
 * Sessions created before draft-boundary tracking can still be actively
 * planning when a newer Eureka process resumes them. Recover the boundary
 * from the first persisted state for that active plan so a post-clarification
 * plan is reviewable without reclassifying older replies in new sessions.
 */
function recoverLegacyDraftBoundary(entries: SessionEntry[], latestStateIndex: number, state: EurekaPlanState): EurekaPlanState {
  if (!state.planModeActive || state.phase !== "planning" || state.draftBoundaryRecorded || !state.activePlanId) return state;
  let activationIndex = -1;
  for (let index = 0; index <= latestStateIndex; index += 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== "eureka_plan" || !isPlanState(entry.data)) continue;
    if (entry.data.activePlanId === state.activePlanId) {
      activationIndex = index;
      break;
    }
  }
  if (activationIndex < 0) return state;
  for (let index = activationIndex - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === "message") {
      return { ...state, draftBoundaryEntryId: entries[index].id, draftBoundaryRecorded: true };
    }
  }
  return { ...state, draftBoundaryEntryId: null, draftBoundaryRecorded: true };
}

export function readPlanState(entries: SessionEntry[]): EurekaPlanState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== "eureka_plan") continue;
    if (isPlanState(entry.data)) {
      const hasPersistedActivePlanId = typeof (entry.data as Partial<EurekaPlanState>).activePlanId === "string"
        && Boolean((entry.data as Partial<EurekaPlanState>).activePlanId);
      let state: EurekaPlanState = {
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
      // Earlier cancel operations only cleared the boolean flag, leaving the
      // phase as "planning". Normalize that stale combination so old sessions
      // restore as ordinary chats while retaining the abandoned plan in history.
      if (hasPersistedActivePlanId && !state.planModeActive && (state.phase === "planning" || state.phase === "reviewing")) {
        state = {
          ...EMPTY_PLAN_STATE,
          plans: state.activePlanId ? [...state.plans, planSnapshot(state)] : state.plans,
        };
      }
      return recoverLegacyDraftBoundary(entries, index, normalizeStoredPlanQuestions(normalizeStoredPlanTodos(state)));
    }
  }
  return EMPTY_PLAN_STATE;
}

export const PLAN_MODE_SYSTEM_PROMPT = `You are in Eureka planning mode. Explore and analyze only. You must not edit files, write files, run shell commands, install packages, invoke MCP/extension tools, commit, or otherwise change the workspace. Do not output implementation source code, complete scripts, patches, or commands that perform the task. First inspect the available context. If material requirements are missing, call request_user_input once with a compact group of 1 to 4 questions. Each question needs 2 to 4 choices and may be single-select or multi-select; never ask a clarification in normal text. If the information is sufficient, state your assumptions instead. Then provide one concise Markdown implementation plan only, with headings exactly equivalent to: Goal, Affected areas, Implementation steps, Risks, and Verification. Every actionable implementation and verification item must use an unchecked checklist item (- [ ]). Affected areas and risks must be ordinary bullets, never checklist items. Do not start implementation until the user explicitly approves the submitted plan.`;

export const PLAN_EXECUTION_SYSTEM_PROMPT = `You are executing a native Eureka plan that the user explicitly approved. The approved plan is included below in this session context; it is not a PLAN.md, plan.md, TODO.md, or any other project file. Do not search for a plan document and do not invoke Plannotator planning commands. Implement the approved checklist in order. Immediately after you actually complete and verify each checklist item, call mark_plan_done with that item's 1-based number before starting the next item. Do not call it for incomplete work, and do not claim the plan is complete while any checklist item remains. Do not add [DONE:n] markers to your final prose; they are retained only for old-session compatibility. If the approved plan is no longer sufficient, stop making changes and ask the user to return to planning mode.`;
