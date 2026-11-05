import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { getAuthConfig } from "./auth/config";
import { automationOwnerKey } from "./automation-owner";
import { AutomationAppStore } from "./automation-app-store";
import { AutomationAppError } from "./automation-app-package";
import { isAppId } from "./automation-app";
import { appActionDetail, appActions, appActionSummaries } from "./automation-app-actions";
import { appJsonValue, appParameters, appRunActive, type AppJson } from "./automation-app-run";
import { appRunValue, getAppRun, readAppConfiguration, saveAppConfiguration, grantAppFile, startAppRun, stopAppRun, answerAppRun } from "./automation-app-runtime";
import { appWebService } from "./automation-app-browser-runtime";
import type { ClarificationRuntime } from "./clarification-runtime";
import { assertManagedAutomationEnabled, managedAutomationState } from "./automation-managed-source";
import { syncOrganizationAutomations } from "./haze-automation-install";
import { samePath } from "./paths";
import { effectivePlugins } from "./haze-registry";
import { prepareSelectedPlugins } from "./composer-plugins";
import { selectionEnvelope, splitPluginSelection, type ComposerPlugin, type SelectedPlugin } from "./plugin-selection";

export const AUTOMATION_CHAT_TOOL = "eureka_automation_run";
declare global { var __eurekaChatAutomationBindings: WeakMap<object, ComposerPlugin[]> | undefined; }
const bindings = globalThis.__eurekaChatAutomationBindings ??= new WeakMap<object, ComposerPlugin[]>();
export function bindChatAutomations(manager: object, entries: ComposerPlugin[]) { bindings.set(manager, entries); return () => bindings.delete(manager); }
export function chatAutomations(manager: object) { return bindings.get(manager) ?? []; }

export function automationChatAccess() {
  const identity = readRuntimeHazeSession(), issuer = getAuthConfig()?.issuer.replace(/\/$/, "");
  if (!identity?.runtimeId || !issuer) throw new AutomationAppError("请先登录 Haze 后使用自动化。", 401);
  const ownerKey = automationOwnerKey(issuer, identity.principal.subject), runtimeId = identity.runtimeId;
  const assertIdentity = () => {
    const current = readRuntimeHazeSession();
    if (!current || current.runtimeId !== runtimeId || current.principal.subject !== identity.principal.subject || current.providerId !== identity.providerId) throw new AutomationAppError("登录身份已变化，请重新选择自动化。", 409);
  };
  assertIdentity();
  return { issuer, subject: identity.principal.subject, ownerKey, runtimeId, assertIdentity, store: new AutomationAppStore(getAgentDir(), ownerKey, assertIdentity) };
}
type Access = ReturnType<typeof automationChatAccess>;

/** Metadata only. Never import or execute installed application entrypoints. */
export async function listAutomationComposerApps(cwd: string): Promise<ComposerPlugin[]> {
  const auth = automationChatAccess();
  await syncOrganizationAutomations({ source: auth.issuer, subject: auth.subject, check: auth.assertIdentity }, cwd);
  await auth.store.useLatest();
  const entries: ComposerPlugin[] = [];
  for (const app of (await auth.store.list()).apps) {
    if (app.disabled) continue;
    // Project installs are visible only in their actual project; global installs work everywhere.
    if (app.managedPlugin) {
      const state = managedAutomationState(app.id, app.managedPlugin);
      if (state.disabled || !state.selected || (state.selected.location.scope === "project" && !samePath(state.selected.location.cwd, cwd))) continue;
    }
    try {
      const detail = await auth.store.detail(app.id), digest = app.versions.find(v => v.version === app.activeVersion)!.digest;
      entries.push({ source: auth.issuer, capabilityId: app.managedPlugin?.capabilityId ?? `automation:${app.id}`, digest: app.managedPlugin ? managedAutomationState(app.id, app.managedPlugin).selected!.item.plugin!.digest : digest,
        name: app.displayName, description: detail.manifest.description, skills: [], state: "loaded", selectionMode: "persistent", subject: auth.subject,
        automation: { id: app.id, revision: app.revision, version: app.activeVersion } });
    } catch { /* Damaged/uninstalled applications are not executable commands. */ }
  }
  auth.assertIdentity(); return entries;
}

/** Keep existing plugin validation intact; automation selections use their runner, not MCP. */
export async function prepareComposerSelection(cwd: string, sessionId: string, raw: SelectedPlugin[], skills: Parameters<typeof prepareSelectedPlugins>[3], message: string) {
  if (!raw.length) return { message, automations: [] as ComposerPlugin[] };
  const hasAutomation = raw.some(ref => ref && (typeof ref.capabilityId === "string" && ref.capabilityId.startsWith("automation:") || effectivePlugins(cwd, ref.source).some(item => item.capabilityId === ref.capabilityId && item.plugin?.manifest.automation)));
  if (!hasAutomation) return { message: prepareSelectedPlugins(cwd, sessionId, raw, skills, message), automations: [] as ComposerPlugin[] };
  const available = await listAutomationComposerApps(cwd), automations: ComposerPlugin[] = [], ordinary: SelectedPlugin[] = [];
  for (const ref of raw) {
    const app = available.find(p => p.source === ref?.source && p.capabilityId === ref?.capabilityId);
    if (!app) { ordinary.push(ref); continue; }
    if (ref.digest !== app.digest || ref.subject && ref.subject !== app.subject) throw new Error("自动化应用或登录账号已变化，请重新选择命令。");
    if (!automations.some(p => p.capabilityId === app.capabilityId)) automations.push(app);
  }
  const normal = splitPluginSelection(prepareSelectedPlugins(cwd, sessionId, ordinary, skills, splitPluginSelection(message).text));
  const context = `${normal.context}\n${automations.length ? `The user selected installed automation applications. Use ${AUTOMATION_CHAT_TOOL} with the appId below; do not regenerate their code, use shell/HTTP to execute them, or re-explore their workflow. Conversation invocation is HEADLESS: inspect saved configuration and declared workflow; configure plain fields via tools, temporary by default or persist=true only when the user asks to save defaults. No run/configuration card or manual Run click exists. When the user requests execution, directly start and then call next with each returned pending stepToken until the actual workflow finishes. Keep the same run for status, login, answers and connection waits. File changes require choose_file and the user's picker; login/questions/scoped approvals use durable clarification and resume this run after the user answers. Never invent grants or approvals. Do not call start repeatedly to advance steps, silently switch executionMode, or retry failed/unknown actions without a user retry. Return actual results and artifact download links. Report real results only. The /automation command creates a NEW application and is distinct from invoking these saved apps.\n${automations.map(p => `${p.name}: appId=${p.automation!.id}; version=${p.automation!.version}; ${p.description}`).join("\n")}` : ""}`;
  return { message: selectionEnvelope(normal.text, [...normal.plugins, ...automations], context), automations };
}

export interface AutomationChatInvocation {
  schemaVersion: 1; id: string; sessionId: string; taskId: string; appId: string; revision: number; version: string; digest: string;
  ownerKey: string; runtimeId: string; createdAt: string; runId: string; configRevision: number; values: Record<string, AppJson>;
  retryOf?: string; previousRunIds?: string[];
  executionMode?: "steps" | "whole";
  actionId?: string;
  interaction?: { kind: "question" | "approval" | "file"; groupId: string; sourceId: string; runId: string; fieldId?: string; persist?: boolean; selected?: boolean; access?: "read" | "readwrite" };
}
function directory(auth: Access, sessionId: string) {
  if (!isAppId(sessionId)) throw new AutomationAppError("会话引用无效。");
  return join(auth.store.dataRoot, "chat-automation", sessionId);
}
async function readInvocation(auth: Access, sessionId: string, id: string) {
  if (!isAppId(id)) throw new AutomationAppError("调用引用无效。");
  const value = JSON.parse((await auth.store.privateBytes(join(directory(auth, sessionId), `${id}.json`), 1024 * 1024)).toString("utf8")) as AutomationChatInvocation;
  if (value.schemaVersion !== 1 || value.id !== id || value.sessionId !== sessionId || value.ownerKey !== auth.ownerKey || !isAppId(value.appId) || !isAppId(value.runId) || !isAppId(value.taskId)) throw new AutomationAppError("自动化调用记录无效。");
  return value;
}
export async function listChatInvocations(auth: Access, sessionId: string) {
  const root = directory(auth, sessionId); await auth.store.managedPath(root);
  let names: string[];
  try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records = await Promise.all(names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(async name => {
    try { return await readInvocation(auth, sessionId, name.slice(0, -5)); } catch { return null; }
  }));
  return records.filter((v): v is AutomationChatInvocation => Boolean(v)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
function executionAccess(auth: Access, detail: Awaited<ReturnType<AutomationAppStore["detail"]>>) {
  const source = detail.install.managedPlugin;
  const location = source ? managedAutomationState(detail.install.id, source).selected?.location : undefined;
  const pinned = source && location ? { ...source, locations: [location] } : source;
  return { ...auth, assertExecution: () => { auth.assertIdentity(); if (pinned) assertManagedAutomationEnabled(detail.install.id, pinned); } };
}
export async function chatInvocationSnapshot(auth: Access, invocation: AutomationChatInvocation) {
  invocation = await readInvocation(auth, invocation.sessionId, invocation.id);
  const baseDetail = await auth.store.detail(invocation.appId);
  let run: Awaited<ReturnType<typeof getAppRun>> | null = null;
  try { run = await getAppRun(executionAccess(auth, baseDetail), invocation.appId, invocation.runId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  auth.assertIdentity();
  const detail = appActionDetail(baseDetail, run?.actionId ?? invocation.actionId);
  return { invocation, detail, run, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId };
}
/** Explicit card click only. Allocate durably before starting through the normal
 * runtime API, so double clicks, another tab and a lost response share one run. */
export async function prepareChatRestart(auth: Access, sessionId: string, id: string, previousRunId: string, nextRunId: string) {
  if (!isAppId(previousRunId) || !isAppId(nextRunId) || previousRunId === nextRunId) throw new AutomationAppError("再次运行引用无效。");
  const root = directory(auth, sessionId); await auth.store.managedPath(root);
  const release = await lockfile.lock(join(root, "conversation"), { realpath: false, retries: { retries: 8, minTimeout: 30, maxTimeout: 150 } });
  try {
    const snapshot = await chatInvocationSnapshot(auth, await readInvocation(auth, sessionId, id));
    const { invocation, detail, run } = snapshot;
    if (invocation.runtimeId !== auth.runtimeId || detail.install.disabled || invocation.revision !== detail.install.revision || invocation.version !== detail.manifest.version) throw new AutomationAppError("登录或应用版本已变化，请重新选择命令后运行。", 409);
    if (invocation.runId !== previousRunId) {
      if (invocation.retryOf === previousRunId) return invocation;
      throw new AutomationAppError("运行记录已变化，请刷新后操作。", 409);
    }
    if (!run || appRunActive(run.status)) throw new AutomationAppError("原运行尚未结束，请等待或先停止。", 409);
    for (const other of await listChatInvocations(auth, sessionId)) {
      if (other.id === invocation.id) continue;
      try {
        if (appRunActive((await getAppRun(auth, other.appId, other.runId)).status)) throw new AutomationAppError("当前会话已有自动化在运行，请等待或先停止。", 409);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    // A proposed ID cannot adopt an unrelated existing run.
    try { await getAppRun(auth, invocation.appId, nextRunId); throw new AutomationAppError("运行引用已被使用。", 409); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const configuration = await readAppConfiguration(auth, invocation.appId, invocation.actionId);
    const updated = { ...invocation, interaction: undefined, runId: nextRunId, retryOf: previousRunId,
      previousRunIds: [...(invocation.previousRunIds ?? []), previousRunId], configRevision: configuration.revision, values: invocation.values };
    auth.assertIdentity();
    await auth.store.privateJson(join(root, `${id}.json`), updated);
    return updated;
  } finally { await release(); }
}
export async function prepareChatInvocation(auth: Access, sessionId: string, taskId: string, app: ComposerPlugin, rawValues: unknown = {}, actionId?: string) {
  if (!isAppId(taskId) || !app.automation) throw new AutomationAppError("自动化任务引用无效。");
  const baseDetail = await auth.store.detail(app.automation.id), detail = appActionDetail(baseDetail, actionId), selectedAction = detail.actionId!;
  const previous = (await listChatInvocations(auth, sessionId)).find(v => v.taskId === taskId && v.appId === app.automation!.id && (v.actionId ?? appActions(baseDetail)[0]?.id) === selectedAction);
  if (previous) return previous; // Same logical request is idempotent, including a lost start response.
  for (const other of (await listChatInvocations(auth, sessionId)).slice(0, 20)) {
    try {
      const run = await getAppRun(auth, other.appId, other.runId);
      if (appRunActive(run.status)) throw new AutomationAppError("当前会话已有自动化在运行，请查看或停止原运行后再开始新的任务。");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (detail.install.disabled || detail.install.revision !== app.automation.revision) throw new AutomationAppError("应用已更新，请重新选择命令。");
  appJsonValue(rawValues, 512 * 1024);
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) throw new AutomationAppError("应用参数必须是对象。");
  const supplied = rawValues as Record<string, unknown>;
  if (Object.keys(supplied).some(id => !detail.ui.fields.some(f => f.id === id))) throw new AutomationAppError("存在应用未声明的参数。");
  if (detail.ui.fields.some(f => ["file", "directory"].includes(f.type) && Object.hasOwn(supplied, f.id))) throw new AutomationAppError("文件和目录必须在配置卡片选择，AI 不能填写文件路径或授权引用。");
  const checked = appParameters(detail.ui, supplied, false);
  const values = Object.fromEntries(Object.keys(supplied).map(key => [key, checked[key]]));
  const configuration = await readAppConfiguration(auth, detail.install.id, selectedAction);
  const invocation: AutomationChatInvocation = { schemaVersion: 1, id: randomUUID(), sessionId, taskId, appId: detail.install.id, revision: detail.install.revision, version: detail.manifest.version,
    digest: detail.install.versions.find(v => v.version === detail.manifest.version)!.digest, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, createdAt: new Date().toISOString(), runId: randomUUID(), configRevision: configuration.revision, values, actionId:selectedAction };
  await auth.store.privateJson(join(directory(auth, sessionId), `${invocation.id}.json`), invocation);
  return invocation;
}
export async function startChatInvocation(auth: Access, invocation: AutomationChatInvocation, actionId?: string, executionMode: "steps" | "whole" = "steps") {
  const snapshot = await chatInvocationSnapshot(auth, invocation);
  invocation = snapshot.invocation;
  if (actionId && actionId !== snapshot.detail.actionId) throw new AutomationAppError("当前调用属于另一个功能，请先为目标功能 prepare，不能切换已准备运行的功能。", 409);
  if (snapshot.run) return snapshot.run;
  if (invocation.runtimeId !== auth.runtimeId || snapshot.detail.install.revision !== invocation.revision || snapshot.detail.manifest.version !== invocation.version) throw new AutomationAppError("登录或应用版本已变化，请重新选择命令确认参数后运行。");
  const config = await readAppConfiguration(auth, invocation.appId, invocation.actionId);
  const values = { ...config.values, ...invocation.values };
  await writeChatInvocation(auth, { ...invocation, executionMode });
  return startAppRun(executionAccess(auth, snapshot.detail), invocation.appId, invocation.revision, invocation.runId, values, config.revision, snapshot.detail.actionId,
    { conversationSteps: executionMode === "steps", persistConfiguration: false, isolatedWorkspace: true });
}
async function writeChatInvocation(auth: Access, invocation: AutomationChatInvocation) {
  auth.assertIdentity(); await auth.store.privateJson(join(directory(auth, invocation.sessionId), `${invocation.id}.json`), invocation);
}
export async function configureChatInvocation(auth: Access, invocation: AutomationChatInvocation, raw: unknown, persist = false, expectedRevision?: number) {
  const { invocation: current, detail, run } = await chatInvocationSnapshot(auth, invocation);
  const config = await readAppConfiguration(auth, current.appId, detail.actionId);
  if (expectedRevision !== undefined && expectedRevision !== config.revision) throw new AutomationAppError("配置已变化，请重新读取后修改。", 409);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AutomationAppError("配置修改必须是字段对象。");
  const supplied = raw as Record<string, unknown>;
  if (Object.keys(supplied).some(key => !detail.ui.fields.some(field => field.id === key))) throw new AutomationAppError("含未声明的配置字段。");
  if (detail.ui.fields.some(field => ["file", "directory"].includes(field.type) && Object.hasOwn(supplied, field.id) && supplied[field.id] !== null)) throw new AutomationAppError("文件配置请使用 choose_file，由用户选择授权，不接受 AI 填入路径或凭证。");
  if (!persist && run) throw new AutomationAppError("运行输入已固定；请为新的执行请求配置参数，不修改当前运行。", 409);
  const merged = appParameters(detail.ui, { ...config.values, ...current.values, ...supplied }, false);
  if (persist) {
    if (expectedRevision === undefined) throw new AutomationAppError("保存默认配置需提供读取时的 configRevision。");
    // Save only the requested patch; unrelated temporary overrides stay temporary.
    await saveAppConfiguration(executionAccess(auth, detail), current.appId, current.revision, config.revision, { ...config.values, ...supplied }, detail.actionId);
  }
  const values = { ...current.values, ...Object.fromEntries(Object.keys(supplied).map(key => [key, merged[key]])) };
  for (const key of persist ? Object.keys(supplied) : []) delete values[key];
  await writeChatInvocation(auth, { ...current, values });
}

/** Translate only durable user answers, never an AI-generated approval flag. */
export async function applyChatInteraction(auth: Access, invocation: AutomationChatInvocation, controller: ClarificationRuntime) {
  const { invocation: current, run } = await chatInvocationSnapshot(auth, invocation), interaction = current.interaction;
  if (!interaction) return;
  const group = controller.group(interaction.groupId);
  if (group.status === "pending") return;
  if (group.task.owner?.source !== auth.issuer || group.task.owner.subject !== auth.subject) throw new AutomationAppError("问题不属于当前用户。", 403);
  if (group.status === "cancelled") {
    if (run && appRunActive(run.status)) await stopAppRun(auth, current.appId, run.id);
  } else if (interaction.kind === "question" && run?.question?.id === interaction.sourceId && run.id === interaction.runId) {
    if (group.questions.length !== run.question.questions.length) throw new AutomationAppError("问题内容已变化。", 409);
    await answerAppRun(auth, current.appId, run.id, interaction.sourceId, group.questions.map((question, index) => ({
      questionId: run.question!.questions[index].id, ...(question.answer?.skipped ? { skipped: true } : question.answer?.custom ? { customAnswer: question.answer.text } : { optionIds: question.answer?.optionIds ?? [] }),
    })));
  } else if (interaction.kind === "approval" && run?.browserApproval?.id === interaction.sourceId && run.id === interaction.runId) {
    const answer = group.questions[0]?.answer;
    if (!answer?.custom && !answer?.skipped && answer?.optionIds?.includes("approve")) {
      const service = appWebService(auth.ownerKey, current.appId, run.id);
      if (service.options.runtimeId !== auth.runtimeId) throw new AutomationAppError("网页登录代次已变化。", 409);
      await service.approve(interaction.sourceId, [run.browserApproval.requestedOperation]);
    } else if (!answer?.custom && answer?.optionIds?.includes("deny")) await stopAppRun(auth, current.appId, run.id);
    // Custom/skipped answers never authorize; the next tool call asks again.
  }
  const latest = await readInvocation(auth, current.sessionId, current.id);
  await writeChatInvocation(auth, { ...latest, interaction: undefined });
}

export async function askChatInteraction(auth: Access, invocation: AutomationChatInvocation, controller: ClarificationRuntime, toolCallId: string,
  file?: { fieldId: string; persist: boolean; access: "read" | "readwrite" }) {
  const { invocation: current, detail, run } = await chatInvocationSnapshot(auth, invocation);
  if (current.interaction && controller.group(current.interaction.groupId).status === "pending") return true;
  if (controller.blocked) return true;
  let kind: "question" | "approval" | "file", sourceId: string;
  let questions: Parameters<ClarificationRuntime["ask"]>[1];
  if (file) {
    const field = detail.ui.fields.find(field => field.id === file.fieldId && ["file", "directory"].includes(field.type));
    if (!field) throw new AutomationAppError("文件配置项无效。");
    if (run) throw new AutomationAppError("请在新运行启动前选择文件。", 409);
    kind = "file"; sourceId = file.fieldId;
    questions = [{ title: field.label, question: `请为“${detail.manifest.displayName}”选择${field.type === "directory" ? "文件夹" : "文件"}。选择后继续原任务。`,
      options: [{ id: "selected", label: "已选择，继续", description: "复用本次选择的文件授权" }], selection: "single" }];
  } else if (run?.question) {
    kind = "question"; sourceId = run.question.id;
    questions = run.question.questions.map(({ title, question, options, selection }) => ({ title, question, options, selection }));
  } else if (run?.browserApproval) {
    const approval = run.browserApproval, operation = approval.operations.find(item => item.id === approval.requestedOperation)!;
    kind = "approval"; sourceId = approval.id;
    questions = [{ title: "网页操作授权", question: `${detail.manifest.displayName} · ${approval.siteLabel}\n网站：${approval.origin}\n账号：${approval.account}\n环境：${approval.environment}\n版本：${approval.version}\n操作：${operation.label}：${operation.description}${approval.target ? `\n对象：${approval.target}` : ""}${approval.value !== undefined ? `\n内容：${JSON.stringify(approval.value)}` : ""}\n允许在此代码版本、账号与操作范围内持续使用？`,
      options: [{ id: "approve", label: "允许此操作范围", description: "仅授权当前声明的操作" }, { id: "deny", label: "拒绝并停止", description: "结束本次自动化" }], selection: "single" }];
  } else return false;
  const group = controller.ask(toolCallId, questions);
  await writeChatInvocation(auth, { ...current, interaction: { kind, sourceId, groupId: group.id, runId: current.runId,
    ...(file ? { fieldId: file.fieldId, persist: file.persist, access: file.access } : {}) } });
  return true;
}

export async function selectChatFile(auth: Access, sessionId: string, id: string, groupId: string, path: string) {
  const { invocation, detail, run } = await chatInvocationSnapshot(auth, await readInvocation(auth, sessionId, id)), request = invocation.interaction;
  if (invocation.runtimeId !== auth.runtimeId || invocation.revision !== detail.install.revision || run || request?.kind !== "file" || request.groupId !== groupId || !request.fieldId) throw new AutomationAppError("文件选择已过期，请重新请求授权。", 409);
  const config = await readAppConfiguration(auth, invocation.appId, invocation.actionId);
  const ref = await grantAppFile(executionAccess(auth, detail), invocation.appId, invocation.revision, request.fieldId, path, request.access ?? "read", detail.actionId);
  if (request.persist) await saveAppConfiguration(executionAccess(auth, detail), invocation.appId, invocation.revision, config.revision, { ...config.values, [request.fieldId]: ref }, detail.actionId);
  await writeChatInvocation(auth, { ...invocation, values: { ...invocation.values, [request.fieldId]: ref as unknown as AppJson }, interaction: { ...request, selected: true } });
}
export async function chatInvocationResult(auth: Access, invocation: AutomationChatInvocation, after = 0) {
  const snapshot = await chatInvocationSnapshot(auth, invocation), run = snapshot.run;
  invocation = snapshot.invocation;
  let result: unknown;
  if (run?.status === "completed" && run.resultRef) {
    const value = await appRunValue(auth, invocation.appId, run.id, run.resultRef);
    result = Buffer.byteLength(JSON.stringify(value)) <= 64000 ? value : { valueRef: run.resultRef, message: "结果较大，请使用 value 分页读取；未返回完整结果。" };
  }
  const config = await readAppConfiguration(auth, invocation.appId, invocation.actionId);
  const effectiveValues = appParameters(snapshot.detail.ui, { ...config.values, ...invocation.values }, false);
  const bounded = (value: unknown, valueRef: string) => Buffer.byteLength(JSON.stringify(value)) <= 6000 ? { value } : { valueRef, tooLarge: true };
  const nodeEvents = (run?.events ?? []).filter(event => event.kind === "node" && event.seq > after);
  const stepEvents = await Promise.all(nodeEvents.slice(0, 40).map(async event => ({ ...event,
    label: run?.workflow.nodes.find(node => node.id === event.nodeId)?.label,
    ...(event.inputRef ? { input: bounded(await appRunValue(auth, invocation.appId, run!.id, event.inputRef), event.inputRef) } : {}),
    ...(event.outputRef ? { output: bounded(await appRunValue(auth, invocation.appId, run!.id, event.outputRef), event.outputRef) } : {}),
  })));
  const pendingSteps = await Promise.all((run?.stepControl?.pending ?? []).map(async step => ({ stepToken: step.token, nodeId: step.nodeId, execution: step.execution,
    label: run?.workflow.nodes.find(node => node.id === step.nodeId)?.label, input: bounded(await appRunValue(auth, invocation.appId, run!.id, step.inputRef), step.inputRef) })));
  const query = new URLSearchParams({ ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, runId: invocation.runId });
  return { invocationId: invocation.id, appId: invocation.appId, name: snapshot.detail.manifest.displayName, runId: invocation.runId, status: run?.status ?? "needs-configuration", error: run?.error, result,
    configRevision: config.revision, savedConfiguration: config.values, configuration: effectiveValues,
    parameters: snapshot.detail.ui.fields.map(f => ({ id: f.id, label: f.label, type: f.type, required: f.required, description: f.description })),
    missingParameters: snapshot.detail.ui.fields.filter(field => field.required && (effectiveValues[field.id] === undefined || effectiveValues[field.id] === null || effectiveValues[field.id] === "")).map(field => field.id),
    workflow: snapshot.detail.workflow, actions: appActionSummaries(snapshot.detail), actionId:snapshot.detail.actionId, actionLabel:snapshot.detail.ui.buttons[0]?.label, executionMode: run?.stepControl ? "steps" : invocation.executionMode ?? "steps",
    pendingSteps, currentStep: run?.stepControl?.current, stepEvents, after: stepEvents.at(-1)?.seq ?? after, hasMoreSteps: nodeEvents.length > stepEvents.length,
    artifacts: run?.artifacts.map(artifact => ({ ...artifact, url: `/api/automation/apps/${invocation.appId}/runtime?${query}&mode=artifact&artifactId=${artifact.id}&filename=${encodeURIComponent(artifact.name)}` })),
    message: run && appRunActive(run.status) ? run.status === "waiting-user" ? "等待澄清卡片回答；回答后复用原运行继续。" : pendingSteps.length && !run.stepControl?.current ? "使用首个 pendingSteps.stepToken 调用 next，执行下一实际步骤；不需要用户点击运行。" : "原步骤仍在执行，使用 status 等待；不要另起运行或重复操作。" : run ? "运行已结束；汇总真实结果及产物。只有用户明确要求重试时调用 restart。" : "默认配置已读取。配置完整且用户要求执行时直接 start；缺失普通字段用澄清，缺失文件用 choose_file。" };
}
export { stopAppRun };
export async function cancelChatInteraction(sessionId: string, groupId: string) {
  if (!readRuntimeHazeSession()?.runtimeId || !getAuthConfig()?.issuer) return;
  const auth = automationChatAccess();
  for (const invocation of await listChatInvocations(auth, sessionId)) {
    if (invocation.interaction?.groupId !== groupId) continue;
    try {
      const run = await getAppRun(auth, invocation.appId, invocation.runId);
      if (appRunActive(run.status)) await stopAppRun(auth, invocation.appId, run.id);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeChatInvocation(auth, { ...invocation, interaction: undefined });
  }
}
export async function stopChatTask(manager: object, sessionId: string, taskId?: string) {
  const selected = chatAutomations(manager);
  if (!selected.length || !taskId) return;
  const auth = automationChatAccess();
  for (const invocation of await listChatInvocations(auth, sessionId)) {
    if (invocation.taskId !== taskId || !selected.some(p => p.automation?.id === invocation.appId)) continue;
    const { run } = await chatInvocationSnapshot(auth, invocation);
    if (run && appRunActive(run.status)) await stopAppRun(auth, invocation.appId, run.id);
  }
}
