import { parsePublicationAiSettings, type PublicationAiSettings } from "../publication/automation-publication-ai-settings";

/** Local per-application execution preferences; never included in a package. */
export type BusinessAiSettings = PublicationAiSettings & { classifierModel?: { provider: string; modelId: string } | null };
export const DEFAULT_BUSINESS_AI: BusinessAiSettings = { model: null, thinkingLevel: null, timeoutMs: 60000, maxTokens: 4000 };
export function parseBusinessAi(value: unknown): BusinessAiSettings {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const { classifierModel, ...raw } = value as Record<string, unknown>;
    const settings = parsePublicationAiSettings({ ...raw, timeoutMs: raw.timeoutMs === undefined ? DEFAULT_BUSINESS_AI.timeoutMs : raw.timeoutMs, maxTokens: raw.maxTokens === undefined ? DEFAULT_BUSINESS_AI.maxTokens : raw.maxTokens });
    return classifierModel === undefined ? settings : { ...settings, classifierModel: parsePublicationAiSettings({ ...settings, model: classifierModel }).model };
  }
  catch { throw new Error("业务 AI 配置无效，请检查模型、推理强度、超时和输出上限。"); }
}
