/** Shared by native planning and ordinary/plugin clarification. */
export interface UserInputOption { id: string; label: string; description: string }
export type UserInputSelection = "single" | "multiple";
export interface UserInputAnswer { optionId?: string; optionIds?: string[]; text: string; custom: boolean; skipped?: boolean }
export interface UserInputResponse { questionId: string; optionIds?: string[]; customAnswer?: string; skipped?: boolean }
export interface UserInputQuestion {
  id: string; toolCallId: string; title: string; question: string; options: UserInputOption[];
  selection?: UserInputSelection; status: "pending" | "answered";
  answer?: UserInputAnswer; askedAt: string; answeredAt?: string;
}

export function validateUserInputResponse(question: UserInputQuestion, response: UserInputResponse): UserInputAnswer {
  const optionIds = Array.isArray(response.optionIds)
    ? [...new Set(response.optionIds.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  const customAnswer = typeof response.customAnswer === "string" ? response.customAnswer.trim() : "";
  if (response.skipped === true) {
    if (optionIds.length || customAnswer) throw new Error("A skipped question cannot also include an answer");
    return { optionIds: [], text: "Skipped", custom: false, skipped: true };
  }
  if (customAnswer) {
    if (optionIds.length) throw new Error("A custom answer cannot be combined with selected options");
    if (customAnswer.length > 20_000) throw new Error("Answer is too long");
    return { optionIds: [], text: customAnswer, custom: true, skipped: false };
  }
  if (!optionIds.length) throw new Error("Choose an option, provide a custom answer, or skip the question");
  if ((question.selection ?? "single") === "single" && optionIds.length !== 1) throw new Error("This question accepts exactly one option");
  const selected = optionIds.map((id) => question.options.find((option) => option.id === id));
  if (selected.some((option) => !option)) throw new Error("The selected option is not available for this question");
  return { optionId: optionIds.length === 1 ? optionIds[0] : undefined, optionIds, text: selected.map((option) => option!.label).join("、"), custom: false, skipped: false };
}

export function userInputSummary(questions: UserInputQuestion[], skippedLabel = "已跳过"): string {
  return questions.map((q) => `- ${q.title}：${q.answer?.skipped ? skippedLabel : q.answer?.text ?? ""}`).join("\n");
}
