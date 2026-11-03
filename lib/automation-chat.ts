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
import { appJsonValue, appParameters, appRunActive, type AppJson } from "./automation-app-run";
import { appRunValue, getAppRun, readAppConfiguration, startAppRun, stopAppRun } from "./automation-app-runtime";
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
  const context = `${normal.context}\n${automations.length ? `The user selected installed automation applications. Use ${AUTOMATION_CHAT_TOOL} with the appId below; do not regenerate their code, use shell/HTTP to execute them, or re-explore their workflow. First prepare the app with the user's NON-FILE parameters. The conversation card reuses the existing configuration, file picker, browser login/approval, canvas and downloads. Start only when the user requested execution and required configuration is ready. Never invent file grants, credentials or local paths. Waiting for login/configuration is not failure. Status/continue inspects the SAME run; never restart uncertain mutations or failed runs without an explicit user retry. Report real results only. The /automation command creates a NEW application and is distinct from invoking these saved apps.\n${automations.map(p => `${p.name}: appId=${p.automation!.id}; version=${p.automation!.version}; ${p.description}`).join("\n")}` : ""}`;
  return { message: selectionEnvelope(normal.text, [...normal.plugins, ...automations], context), automations };
}

export interface AutomationChatInvocation {
  schemaVersion: 1; id: string; sessionId: string; taskId: string; appId: string; revision: number; version: string; digest: string;
  ownerKey: string; runtimeId: string; createdAt: string; runId: string; configRevision: number; values: Record<string, AppJson>;
  retryOf?: string; previousRunIds?: string[];
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
  const detail = await auth.store.detail(invocation.appId);
  let run: Awaited<ReturnType<typeof getAppRun>> | null = null;
  try { run = await getAppRun(executionAccess(auth, detail), invocation.appId, invocation.runId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  auth.assertIdentity();
  return { invocation, detail, run, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId };
}
/** Explicit card click only. Allocate durably before starting through the normal
 * runtime API, so double clicks, another tab and a lost response share one run. */
export async function prepareChatRestart(auth: Access, sessionId: string, id: string, previousRunId: string, nextRunId: string) {
  if (!isAppId(previousRunId) || !isAppId(nextRunId) || previousRunId === nextRunId) throw new AutomationAppError("再次运行引用无效。");
  const root = directory(auth, sessionId); await auth.store.managedPath(root);
  const release = await lockfile.lock(join(root, "restart"), { realpath: false, retries: { retries: 8, minTimeout: 30, maxTimeout: 150 } });
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
    const configuration = await readAppConfiguration(auth, invocation.appId);
    const updated = { ...invocation, runId: nextRunId, retryOf: previousRunId,
      previousRunIds: [...(invocation.previousRunIds ?? []), previousRunId], configRevision: configuration.revision, values: {} };
    auth.assertIdentity();
    await auth.store.privateJson(join(root, `${id}.json`), updated);
    return updated;
  } finally { await release(); }
}
export async function prepareChatInvocation(auth: Access, sessionId: string, taskId: string, app: ComposerPlugin, rawValues: unknown = {}) {
  if (!isAppId(taskId) || !app.automation) throw new AutomationAppError("自动化任务引用无效。");
  const previous = (await listChatInvocations(auth, sessionId)).find(v => v.taskId === taskId && v.appId === app.automation!.id);
  if (previous) return previous; // Same logical request is idempotent, including a lost start response.
  for (const other of (await listChatInvocations(auth, sessionId)).slice(0, 20)) {
    try {
      const run = await getAppRun(auth, other.appId, other.runId);
      if (appRunActive(run.status)) throw new AutomationAppError("当前会话已有自动化在运行，请查看或停止原运行后再开始新的任务。");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const detail = await auth.store.detail(app.automation.id);
  if (detail.install.disabled || detail.install.revision !== app.automation.revision) throw new AutomationAppError("应用已更新，请重新选择命令。");
  appJsonValue(rawValues, 512 * 1024);
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) throw new AutomationAppError("应用参数必须是对象。");
  const supplied = rawValues as Record<string, unknown>;
  if (Object.keys(supplied).some(id => !detail.ui.fields.some(f => f.id === id))) throw new AutomationAppError("存在应用未声明的参数。");
  if (detail.ui.fields.some(f => ["file", "directory"].includes(f.type) && Object.hasOwn(supplied, f.id))) throw new AutomationAppError("文件和目录必须在配置卡片选择，AI 不能填写文件路径或授权引用。");
  const checked = appParameters(detail.ui, supplied, false);
  const values = Object.fromEntries(Object.keys(supplied).map(key => [key, checked[key]]));
  const configuration = await readAppConfiguration(auth, detail.install.id);
  const invocation: AutomationChatInvocation = { schemaVersion: 1, id: randomUUID(), sessionId, taskId, appId: detail.install.id, revision: detail.install.revision, version: detail.manifest.version,
    digest: detail.install.versions.find(v => v.version === detail.manifest.version)!.digest, ownerKey: auth.ownerKey, runtimeId: auth.runtimeId, createdAt: new Date().toISOString(), runId: randomUUID(), configRevision: configuration.revision, values };
  await auth.store.privateJson(join(directory(auth, sessionId), `${invocation.id}.json`), invocation);
  return invocation;
}
export async function startChatInvocation(auth: Access, invocation: AutomationChatInvocation, actionId?: string) {
  const snapshot = await chatInvocationSnapshot(auth, invocation);
  invocation = snapshot.invocation;
  if (snapshot.run) return snapshot.run;
  if (invocation.runtimeId !== auth.runtimeId || snapshot.detail.install.revision !== invocation.revision || snapshot.detail.manifest.version !== invocation.version) throw new AutomationAppError("登录或应用版本已变化，请重新选择命令确认参数后运行。");
  const config = await readAppConfiguration(auth, invocation.appId);
  const values = config.revision === invocation.configRevision ? { ...config.values, ...invocation.values } : config.values;
  return startAppRun(executionAccess(auth, snapshot.detail), invocation.appId, invocation.revision, invocation.runId, values, config.revision, actionId ?? snapshot.detail.ui.buttons[0]?.id);
}
export async function chatInvocationResult(auth: Access, invocation: AutomationChatInvocation) {
  const snapshot = await chatInvocationSnapshot(auth, invocation), run = snapshot.run;
  invocation = snapshot.invocation;
  let result: unknown;
  if (run?.status === "completed" && run.resultRef) {
    const value = await appRunValue(auth, invocation.appId, run.id, run.resultRef);
    result = Buffer.byteLength(JSON.stringify(value)) <= 64000 ? value : { availableInCard: true, message: "结果较大，请在对话运行卡片查看或下载，不省略后假装完整。" };
  }
  return { invocationId: invocation.id, appId: invocation.appId, name: snapshot.detail.manifest.displayName, runId: invocation.runId, status: run?.status ?? "needs-configuration", error: run?.error, result,
    parameters: snapshot.detail.ui.fields.map(f => ({ id: f.id, label: f.label, type: f.type, required: f.required, description: f.description })),
    actions: snapshot.detail.ui.buttons, message: run && appRunActive(run.status) ? "复用当前运行；登录、授权和问题在对话运行卡片中处理。不要另起一次运行。" : run ? "这是该次真实运行的状态，不自动重试。" : "运行卡片已准备，请确认配置；文件必须用卡片的选择器选择。尚未运行。" };
}
export { stopAppRun };
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
