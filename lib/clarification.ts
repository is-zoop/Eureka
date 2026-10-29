import type { SessionEntry } from "./types";
import type { SelectedPlugin } from "./plugin-selection";
import { userInputSummary, validateUserInputResponse, type UserInputQuestion, type UserInputResponse } from "./user-input";

export const CLARIFICATION_ENTRY = "eureka_clarification";
export interface ClarificationTask {
  id: string; clarificationEnabled: boolean; plugins: SelectedPlugin[];
  owner?: { source: string; subject: string };
}
export interface ClarificationGroup {
  id: string; task: ClarificationTask; source: "general" | "plugin";
  questions: UserInputQuestion[]; status: "pending" | "answered" | "cancelled";
  continuation: "ready" | "running" | "completed" | "failed";
  error?: string; createdAt: string;
}
export interface ClarificationQueuedInput {
  id: string; message: string; clarificationEnabled: boolean; selectedPlugins?: SelectedPlugin[];
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  behavior: "steer" | "followUp";
  owner?: { source: string; subject: string };
  paused?: boolean;
}
export interface ClarificationState { version: 1; revision: number; groups: ClarificationGroup[]; queue: ClarificationQueuedInput[] }
export const EMPTY_CLARIFICATION: ClarificationState = { version: 1, revision: 0, groups: [], queue: [] };

export function clarificationContinuationText(group: ClarificationGroup): string {
  return `已回答问题澄清：\n${userInputSummary(group.questions)}\n继续原任务，复用已有业务会话和选数范围。已跳过的问题不代表同意任何选项。`;
}

export function readClarificationState(entries: SessionEntry[]): ClarificationState {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== CLARIFICATION_ENTRY) continue;
    const state = entry.data as ClarificationState | undefined;
    if (state?.version === 1 && Array.isArray(state.groups) && Array.isArray(state.queue)) return state;
  }
  return { ...EMPTY_CLARIFICATION, groups: [], queue: [] };
}
export function pendingClarification(state: ClarificationState): ClarificationGroup | undefined {
  return state.groups.find((group) => group.status === "pending");
}
export function blockingClarification(state: ClarificationState): ClarificationGroup | undefined {
  return state.groups.find((group) => group.status === "pending" || (group.status === "answered" && (group.continuation === "ready" || group.continuation === "failed")));
}
export function answerClarification(group: ClarificationGroup, responses: UserInputResponse[], now: string): ClarificationGroup {
  if (!Array.isArray(responses) || responses.length !== group.questions.length) throw new Error("请回答或跳过本组全部问题");
  const byId = new Map(responses.map((response) => [response?.questionId, response]));
  if (byId.size !== responses.length) throw new Error("每个问题只能提交一个回答");
  const questions = group.questions.map((question) => {
    const response = byId.get(question.id);
    if (!response) throw new Error("问题已变化，请刷新后重试");
    return { ...question, answer: validateUserInputResponse(question, response), status: "answered" as const, answeredAt: now };
  });
  if (group.status === "answered") {
    if (JSON.stringify(questions.map((q) => q.answer)) !== JSON.stringify(group.questions.map((q) => q.answer))) throw new Error("此问题组已提交，不能替换回答");
    return group;
  }
  if (group.status !== "pending") throw new Error("此问题组已取消");
  return { ...group, questions, status: "answered", continuation: "ready" };
}
