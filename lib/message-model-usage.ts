import type { AssistantMessage } from "./types";

export type CostSource = "provider" | "estimate" | "unknown";

/** Keep old records' unknown source distinct from an explicit SDK estimate. */
export function messageCost(usage: AssistantMessage["usage"]): { total: number; source: CostSource } | null {
  const total = usage?.cost?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return null;
  const reported = usage?.cost?.totalFromProvider;
  return { total, source: reported === true ? "provider" : reported === false ? "estimate" : "unknown" };
}

export function messageModelLabel(message: Pick<AssistantMessage, "provider" | "model" | "responseModel">, names?: Record<string, string>) {
  const model = names?.[`${message.provider}:${message.model}`] ?? names?.[message.model] ?? message.model;
  const responseModel = typeof message.responseModel === "string" ? message.responseModel.trim() : "";
  return { model, responseModel: responseModel && responseModel !== message.model ? responseModel : null };
}
