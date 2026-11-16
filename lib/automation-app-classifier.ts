import type { ClassifierQuestion, ClassifierResult, Usage } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AppAiRule, AppAiExecutionOptions } from "./automation-app-ai";
import { AppAiInputError, prepareAppAiContent, splitAppAiInput } from "./automation-app-ai-images";

export function classifierQuestion(rule: AppAiRule): ClassifierQuestion {
  const raw = rule.classifier;
  const invalid = (message: string): never => { throw new AppAiInputError(message); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid('缺少 classifier 对象；type、criteria 必须放在 classifier 内，不能放在规则根部。例如 classifier:{type:"bool",criteria:{true:"符合",false:"不符合"}}，并设置 output:{type:"boolean"}。完整示例见 SDK ai 章节。');
  if (!["bool", "choice", "score"].includes(raw.type)) return invalid("classifier.type 必须是 bool、choice 或 score。");
  const validText = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 2000;
  const criteria = raw.criteria;
  const expected = { bool: "boolean", choice: "text", score: "number" }[raw.type];
  if (rule.output?.type !== expected) return invalid(`classifier.type 为 ${raw.type} 时，output.type 必须是 ${expected}，不能是 ${rule.output?.type ?? "未声明"}；如需对象结果，请在脚本中包装 ctx.ai 的返回值。`);
  if (raw.type === "score") {
    if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 50 || !criteria.every(validText)) return invalid("classifier.criteria 在 score 分类中必须是 2–50 项非空等级说明数组，按从低到高排列，每项最多 2000 字符。");
    return { type: "score", instructions: rule.instruction, criteria };
  }
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || !Object.values(criteria).every(validText)) return invalid("classifier.criteria 必须是标签到非空说明的对象，不能是数组；每项说明最多 2000 字符。bool 使用 true/false 两个键，choice 使用自定义标签。");
  const keys = Object.keys(criteria);
  if (raw.type === "bool") {
    if (keys.length !== 2 || !keys.includes("true") || !keys.includes("false")) return invalid('classifier.criteria 在 bool 分类中只能包含 "true"、"false" 两个键，值为各自的判断标准。');
    return { type: "bool", instructions: rule.instruction, criteria: criteria as { true: string; false: string } };
  }
  if (keys.length < 2 || keys.length > 50 || keys.some(k => !k.trim() || k.length > 128)) return invalid("classifier.criteria 在 choice 分类中必须包含 2–50 个标签，标签长度为 1–128 字符。");
  return { type: "choice", instructions: rule.instruction, criteria };
}

export function classifierValue(result: ClassifierResult, question: ClassifierQuestion): string | number | boolean {
  if (result.stopReason !== "stop") throw new AppAiInputError("分类模型请求未完成，请检查模型连接和配额；不自动重试。");
  const answer = result.answers?.result;
  if (!answer || answer.type !== question.type) throw new AppAiInputError("分类模型没有返回声明的结果类型。");
  if (answer.type === "bool" && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1) return answer.probability >= 0.5;
  if (answer.type === "choice" && question.type === "choice" && Object.hasOwn(question.criteria, answer.choice)) return answer.choice;
  if (answer.type === "score" && question.type === "score" && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= question.criteria.length - 1) return answer.score;
  throw new AppAiInputError("分类模型返回了无效结果。");
}

function safeUsage(usage?: Usage): Usage | undefined {
  if (!usage) return undefined;
  const number = (v: number) => Number.isFinite(v) && v >= 0 ? v : 0;
  return { input: number(usage.input), output: number(usage.output), cacheRead: number(usage.cacheRead), cacheWrite: number(usage.cacheWrite), totalTokens: number(usage.totalTokens), cost: { input: number(usage.cost?.input), output: number(usage.cost?.output), cacheRead: number(usage.cost?.cacheRead), cacheWrite: number(usage.cost?.cacheWrite), total: number(usage.cost?.total), ...(typeof usage.cost?.totalFromProvider === "boolean" ? { totalFromProvider: usage.cost.totalFromProvider } : {}) } };
}

export async function executeClassification(runtime: Pick<ModelRuntime, "getAvailableOfType" | "classify">, rule: AppAiRule, rawInput: unknown, signal: AbortSignal, check: () => void, options: AppAiExecutionOptions) {
  const ensureActive = () => { check(); if (signal.aborted) throw new AppAiInputError("AI 判断已取消，不自动重试。"); };
  ensureActive();
  const question = classifierQuestion(rule), selected = options.classifierModel;
  if (!selected) throw new AppAiInputError("请先在应用配置中选择分类模型。");
  const model = (await runtime.getAvailableOfType("classifier")).find(m => m.provider === selected.provider && m.id === selected.modelId);
  ensureActive();
  if (!model) throw new AppAiInputError("所选分类模型不可用，请检查模型和凭证配置。");
  const input = splitAppAiInput(rawInput, options.inputOptions);
  if (input.images.length && !model.input.includes("image")) throw new AppAiInputError("所选分类模型不支持图片输入。");
  const content = await prepareAppAiContent(input, options.readImage, ensureActive);
  await options.onModel?.({ provider: model.provider, modelId: model.id }, "classify"); ensureActive();
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 60000)]);
  let result: ClassifierResult;
  try { result = await runtime.classify(model, { state: { input: input.text }, questions: { result: question }, ...(input.images.length ? { images: content.filter(item => item.type === "image") } : {}) }, { signal: requestSignal, maxRetries: 0 }); }
  catch { ensureActive(); throw new AppAiInputError(requestSignal.aborted ? "分类模型请求超时，不自动重试。" : "分类模型请求失败，请检查连接和配额；不自动重试。"); }
  ensureActive();
  const usage = safeUsage(result.usage);
  await options.onUsage?.({ operation: "classify", model: { provider: model.provider, modelId: model.id }, ...(usage ? { usage } : {}), timestamp: Date.now() }); ensureActive();
  if (requestSignal.aborted) throw new AppAiInputError("分类模型请求超时，不自动重试。");
  return classifierValue(result, question);
}
