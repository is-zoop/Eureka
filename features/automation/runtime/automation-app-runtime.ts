import { sdkContractSummary } from "../sdk/automation-sdk-contract";
import { readBusinessAi } from "./automation-business-ai-store";
import { snapshotArtifact, streamArtifact, validateArtifact } from "./automation-artifacts";
import { spawn, type ChildProcess } from "node:child_process";
import { assertDesktopUpdateIdle, withDesktopUpdateAdmission } from "../../../server/desktop/desktop-update-gate";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutomationAppDetail } from "../shared/automation-app";
import { isAppId } from "../shared/automation-app";
import { AutomationAppError } from "./automation-app-package";
import type { AutomationAppStore } from "./automation-app-store";
import { AppFileOperations, AutomationAppFiles } from "./automation-app-files";
import { AppTableOperations } from "./automation-tables";
import { streamAppDownload } from "./automation-app-download";
import { prepareAppUpload } from "./automation-app-upload";
import { appHasLease, takeAppLease } from "./automation-app-lease";
import { appJsonValue, appParameters, appRunActive, newestAppRuns, type AppConfiguration, type AppRunEvent, type AppRunRecord, type AppRunStatus } from "./automation-app-run";
import { validateUserInputResponse, type UserInputQuestion, type UserInputResponse } from "../../chat/shared/user-input";
import { AUTOMATION_WORKER_SOURCE, AUTOMATION_SUPERVISOR_SOURCE } from "./automation-app-worker";
import lockfile from "proper-lockfile";
import { ApplicationBrowserRuntime } from "./automation-app-browser-runtime";
import { executeAppAi, parseAppAiRules } from "./automation-app-ai";
import { automationNodeLaunch,automationStartError,automationFilePermissionFlags } from "./automation-node-runtime";
import { AutomationStepDriver } from "./automation-step-driver";
import { appActionDetail, appActionConfigurationScope, appActions } from "./automation-app-actions";
import { APP_EXECUTION_VALUE_MAX_BYTES } from "../shared/automation-data-limits";
import { assertCheckpointCompatible, checkpointHash, checkpointInputs, checkpointState, type AppCheckpoint } from "./automation-checkpoints";
import sdkContract from "../sdk/automation-sdk-contract.json";

type Access = { ownerKey: string; runtimeId: string; store: AutomationAppStore; assertIdentity: () => void; assertExecution?:()=>void; taskId?: string };
interface LiveRun {
  auth: Access; detail: AutomationAppDetail; record: AppRunRecord; directory: string; child: ChildProcess;
  closed: Promise<void>; release: () => Promise<void>; journal: Promise<void>; finishing: boolean; rpc: number; executions: number;
  open: Map<number, string>; fileOps: AppFileOperations; stopKind?: "cancelled" | "failed" | "interrupted";
  tables?: AppTableOperations;
  checkpoint?: AppCheckpoint;
  resumedCheckpoint?: AppCheckpoint;
  mutationGate?: Promise<void>;
  browserUploads?: (() => Promise<void>)[];
  artifactCount?: number;
  requests: Set<Promise<unknown>>;
  browser?: ApplicationBrowserRuntime;
  stepDriver?: AutomationStepDriver;
  aiAbort?: AbortController; aiCalls?: number;
  watchdog?: ReturnType<typeof setInterval>; killTimer?: ReturnType<typeof setTimeout>;
  question?: { id: string; resolve: (v: unknown) => void; reject: (e: Error) => void; answering?: boolean };
}
const globals = globalThis as typeof globalThis & { __eurekaAppRuns?: { serverId: string; live: Map<string, LiveRun> } };
const runtime = globals.__eurekaAppRuns ??= { serverId: randomUUID(), live: new Map<string, LiveRun>() };
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 3000);
function fail(message: string, status = 409): never { throw new AutomationAppError(message, status); }
function runDirectory(store: AutomationAppStore, appId: string, runId: string) { if (!isAppId(runId)) fail("运行 ID 无效", 400); return join(store.dataDirectory(appId), "logs", "runs", runId); }
const rawHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parameters(detail: AutomationAppDetail, values: unknown, required: boolean) {
  try { return appParameters(detail.ui, values, required); } catch (e) { throw new AutomationAppError(errorMessage(e), 400); }
}
function snapshot(live: LiveRun) {
  const job = live.journal.then(() => live.auth.store.privateJson(join(live.directory, "run.json"), { ...live.record, events: [] }));
  live.journal = job.catch(() => {}); return job;
}
function assertResumeBindings(live: LiveRun) {
  const current = live.browser?.checkpointBindings() ?? [];
  if (live.resumedCheckpoint?.bindings.some(expected => !current.some(binding => binding.siteId === expected.siteId && binding.environment === expected.environment && binding.accountHash === expected.accountHash))) throw new Error("恢复写入前需重新连接并核对检查点中的全部网站账号。");
}
async function checkpointMutation(live: LiveRun) {
  check(live); assertResumeBindings(live); if (!live.checkpoint) return;
  if (live.checkpoint.unsafe) { await live.mutationGate; return; }
  // Persist BEFORE the side effect. A crash cannot make an old batch look safe.
  live.checkpoint.unsafe = true;
  if (live.record.checkpoint) live.record.checkpoint.unsafe = true;
  live.mutationGate = (async () => { await live.auth.store.privateJson(join(live.directory, "checkpoint.json"), live.checkpoint); await snapshot(live); check(live); })();
  await live.mutationGate;
}
function emit(live: LiveRun, event: Omit<AppRunEvent, "seq" | "at" | "runId">) {
  const job = live.journal.then(async () => {
    if (live.record.events.length >= 2500 && event.kind !== "run") throw new Error("运行事件超过 2500 条限制。");
    const item: AppRunEvent = { ...event, seq: live.record.events.length + 1, at: new Date().toISOString(), runId: live.record.id };
    await appendFile(join(live.directory, "events.jsonl"), JSON.stringify(item) + "\n", { mode: 0o600 }); live.record.events.push(item);
  });
  live.journal = job.catch(() => {}); return job;
}
async function valueRef(live: LiveRun, value: unknown) {
  const clean = appJsonValue(value, APP_EXECUTION_VALUE_MAX_BYTES), ref = `${randomUUID()}.json`;
  await live.auth.store.privateJson(join(live.directory, "values", ref), clean); return ref;
}
function check(live: LiveRun) {
  live.auth.assertIdentity();live.auth.assertExecution?.(); if (live.finishing || live.stopKind) throw new Error("运行已停止，不再执行后续操作。");
}
function serverExists(pid: number) { if (!Number.isSafeInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; } }
async function readRecordHeader(auth: Access, appId: string, id: string): Promise<AppRunRecord> {
  const dir = runDirectory(auth.store, appId, id);
  const record = JSON.parse((await auth.store.privateBytes(join(dir, "run.json"), 3 * 1024 * 1024)).toString("utf8")) as AppRunRecord;
  if (record.schemaVersion !== 1 || record.id !== id || record.appId !== appId || !Array.isArray(record.artifacts)) fail("运行记录损坏。");
  auth.assertIdentity(); return record;
}
async function readRecord(auth: Access, appId: string, id: string, reconcile = true): Promise<AppRunRecord> {
  const dir = runDirectory(auth.store, appId, id), record = await readRecordHeader(auth, appId, id);
  let events: AppRunEvent[] = [];
  try { const text = (await auth.store.privateBytes(join(dir, "events.jsonl"), 24 * 1024 * 1024)).toString("utf8"); events = text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  record.events = events;
  // A service restart only reconciles terminal state; never imports or restarts code.
  if (reconcile && appRunActive(record.status) && !runtime.live.has(id) && (!serverExists(record.serverPid) || !await appHasLease(auth.store.dataDirectory(appId), record.isolation === "run" ? id : undefined))) {
    const release = await lockfile.lock(join(dir, "reconcile"), { realpath: false, retries: { retries: 6, minTimeout: 25, maxTimeout: 100 } });
    try {
      const fresh = await readRecord(auth, appId, id, false);
      if (appRunActive(fresh.status) && !runtime.live.has(id)) {
        fresh.status = "interrupted"; fresh.finishedAt = new Date().toISOString(); fresh.error = "本机服务已重启或运行进程退出，本轮已中断，不会自动重跑。"; delete fresh.question; delete fresh.browserApproval;
        const event: AppRunEvent = { seq: fresh.events.length + 1, runId: id, at: fresh.finishedAt, kind: "run", status: "interrupted", message: fresh.error };
        await appendFile(join(dir, "events.jsonl"), JSON.stringify(event) + "\n"); fresh.events.push(event);
        await auth.store.privateJson(join(dir, "run.json"), { ...fresh, events: [] });
      }
      return fresh;
    } finally { await release(); }
  }
  auth.assertIdentity(); return record;
}
export async function readAppConfiguration(auth: Access, appId: string, actionId?: string): Promise<AppConfiguration> {
  const detail = appActionDetail(await auth.store.detail(appId), actionId), scope = appActionConfigurationScope(detail);
  try { const raw = JSON.parse((await auth.store.privateBytes(join(auth.store.dataDirectory(appId), ...(scope ? ["action-config", `${scope}.json`] : ["config.json"])), 1024 * 1024)).toString("utf8")); if (raw.schemaVersion !== 1 || !raw.values || typeof raw.values !== "object" || Array.isArray(raw.values)) fail("配置文件无效。"); return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, values: raw.values }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, revision: 0, values: {} }; throw e; }
}
async function saveConfiguration(auth: Access, detail: AutomationAppDetail, values: unknown, revision: number, required: boolean) {
  const current = await readAppConfiguration(auth, detail.install.id, detail.actionId); if (current.revision !== revision) fail("配置已变化，请重新读取后保存。");
  const configuration: AppConfiguration = { schemaVersion: 1, revision: revision + 1, values: parameters(detail, values, required) };
  try { appJsonValue(configuration.values, 512 * 1024); } catch { fail("配置超过 512 KiB，请将大量数据作为文件输入。", 400); }
  const scope = appActionConfigurationScope(detail);
  if (scope) await auth.store.ensureDataDirectory(join(detail.dataDirectory, "action-config"));
  await auth.store.privateJson(join(detail.dataDirectory, ...(scope ? ["action-config", `${scope}.json`] : ["config.json"])), configuration); return configuration;
}
export async function saveAppConfiguration(auth: Access, appId: string, revision: number, configRevision: number, values: unknown, actionId?: string) {
  return auth.store.admitRun(appId, revision, detail => saveConfiguration(auth, appActionDetail(detail, actionId), values, configRevision, false), false);
}
export async function grantAppFile(auth: Access, appId: string, revision: number, fieldId: string, path: string, access: "read" | "readwrite", actionId?: string) {
  return auth.store.admitRun(appId, revision, detail => new AutomationAppFiles(auth.store, appActionDetail(detail, actionId)).grant(fieldId, path, access), false);
}
export async function listAppRuns(auth: Access, appId: string, actionId?: string) {
  const root = join(auth.store.dataDirectory(appId), "logs", "runs"); await auth.store.managedPath(root);
  let ids: string[]; try { ids = (await readdir(root)).filter(isAppId); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  // Read only headers to select the newest runs; load event logs for that page only.
  const dated = await Promise.all(ids.map(async id => {
    try { const record = await readRecordHeader(auth, appId, id); return actionId && record.actionId !== actionId ? null : { id, startedAt: record.startedAt }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }));
  const result: AppRunRecord[] = [];
  for (const { id } of newestAppRuns(dated.filter((item): item is { id: string; startedAt: string } => item !== null)).slice(0, 30)) result.push(await getAppRun(auth, appId, id));
  return result;
}
export async function getAppRun(auth: Access, appId: string, id: string) {
  const live = runtime.live.get(id); if (live && (live.auth.ownerKey !== auth.ownerKey || live.record.appId !== appId || live.auth.store.base!==auth.store.base)) fail("运行不属于当前应用或创建任务。");
  const record = live ? structuredClone(live.record) : await readRecord(auth, appId, id); auth.assertIdentity(); return record;
}
async function finish(live: LiveRun, status: AppRunStatus, error?: string, result?: unknown) {
  if (live.finishing) return; live.finishing = true;
  if (live.watchdog) clearInterval(live.watchdog); if (live.killTimer) clearTimeout(live.killTimer);
  live.stepDriver?.close("运行已结束。");
  if (live.record.stepControl) live.record.stepControl = { mode: "conversation", pending: [] };
  live.question?.reject(new Error("运行已结束。")); live.question = undefined; delete live.record.question;
  live.browser?.close(); delete live.record.browserApproval;
  live.aiAbort?.abort();
  try {
    if (result !== undefined && status === "completed") live.record.resultRef = await valueRef(live, result);
    for (const [execution, nodeId] of live.open) await emit(live, { kind: "node", status: status === "completed" ? "failed" : status, nodeId, execution, message: "节点尚未结束，运行已终止。" });
    live.open.clear(); live.record.status = status; live.record.finishedAt = new Date().toISOString(); if (error) live.record.error = error;
    await emit(live, { kind: "run", status, ...(error ? { message: error } : {}) }); await snapshot(live);
  } catch (e) {
    live.record.status = "failed"; live.record.finishedAt = new Date().toISOString(); live.record.error = errorMessage(e);
    try { await emit(live, { kind: "run", status: "failed", message: live.record.error }); await snapshot(live); } catch { /* Next read reports interruption if persistence failed. */ }
  }
  finally {
    if (live.child.connected) live.child.send({ type: "hard-stop" }, () => {}); await live.closed;
    await Promise.allSettled([...live.requests]);
    await live.tables?.dispose(); await live.fileOps.dispose();
    await Promise.allSettled((live.browserUploads ?? []).map(dispose => dispose()));
    try { await live.release(); } catch { /* Lost or stale lease; no work is resumed. */ } finally { runtime.live.delete(live.record.id); }
  }
}
async function stop(live: LiveRun, kind: "cancelled" | "failed" | "interrupted", reason: string) {
  if (live.finishing || live.stopKind) return;
  live.stopKind = kind; live.record.status = "cancelling"; live.record.error = reason;
  live.stepDriver?.close(reason);
  if (live.record.stepControl) live.record.stepControl = { mode: "conversation", pending: [] };
  live.browser?.close(reason); delete live.record.browserApproval;
  live.aiAbort?.abort();
  live.question?.reject(new Error(reason)); live.question = undefined; delete live.record.question;
  if (live.child.connected) live.child.send({ type: "cancel" }, () => {});
  live.killTimer = setTimeout(() => { if (live.child.connected) live.child.send({ type: "hard-stop" }, () => {}); }, 2000);
  try { await emit(live, { kind: "run", status: "cancelling", message: reason }); await snapshot(live); } catch { /* Identity loss must still stop the child and release its lease. */ }
}
function questions(raw: unknown, groupId: string): UserInputQuestion[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 4) throw new Error("每次询问支持 1～4 个问题。");
  return raw.map(v => {
    if (!v || typeof v.question !== "string" || !v.question.trim() || v.question.length > 2000 || typeof v.title !== "string" || v.title.length > 100 || !Array.isArray(v.options) || v.options.length > 8) throw new Error("问题声明无效。");
    const options = v.options.map((o: Record<string, unknown>, i: number) => { if (!o || typeof o.label !== "string" || o.label.length > 200 || (o.description !== undefined && typeof o.description !== "string")) throw new Error("问题选项无效。"); return { id: String(i + 1), label: o.label, description: typeof o.description === "string" ? o.description.slice(0, 1000) : "" }; });
    return { id: randomUUID(), toolCallId: groupId, title: v.title, question: v.question, options, selection: v.selection === "multiple" ? "multiple" as const : "single" as const, status: "pending" as const, askedAt: new Date().toISOString() };
  });
}
async function rpc(live: LiveRun, method: string, args: unknown[], context: { nodeId?: string; execution?: number } | null, systemAsk = false): Promise<unknown> {
  check(live);
  if (method.startsWith("checkpoints.")) {
    if (!live.detail.manifest.automation.checkpoints || live.auth.taskId || live.record.isolation || live.stepDriver) throw new Error("检查点仅用于显式启用的已安装应用整流程运行。");
    if (method === "checkpoints.load") return live.resumedCheckpoint ? { key: live.resumedCheckpoint.key, state: live.resumedCheckpoint.state, sourceRunId: live.record.resumedFrom } : null;
    if (method !== "checkpoints.save" || live.rpc > 1 || live.fileOps.hasOpenWriters || live.tables?.hasOpenWriters) throw new Error("保存检查点前请等待其他操作完成，并提交或取消文件和表格写入。");
    const value = checkpointState(args[0], args[1]), bindings = live.browser?.checkpointBindings() ?? [];
    assertResumeBindings(live);
    if (bindings.some(binding => !binding.account || binding.environment.startsWith("temporary:"))) throw new Error("浏览器检查点需要可核对的账号和持久环境。");
    const params = JSON.parse((await live.auth.store.privateBytes(join(live.directory, "parameters.json"), 1024 * 1024)).toString("utf8"));
    const grants = await new AutomationAppFiles(live.auth.store, live.detail).validateReferences(params, live.record.digest);
    const credentials = live.browser?.checkpointCredentials() ?? {};
    if (Object.values(credentials).some(value => !isAppId(value))) throw new Error("请重新保存接口凭证后再创建检查点。");
    const valueToSave: AppCheckpoint = { schemaVersion: 1, appId: live.record.appId, version: live.record.version, digest: live.record.digest, actionId: live.record.actionId, paramsHash: checkpointHash(params), inputs: await checkpointInputs(grants, () => check(live)), bindings, credentials, ...(live.record.aiSettings ? { aiSettingsHash: checkpointHash(live.record.aiSettings) } : {}), ...value, savedAt: new Date().toISOString(), unsafe: false };
    check(live); await live.auth.store.privateJson(join(live.directory, "checkpoint.json"), valueToSave); check(live); live.checkpoint = valueToSave;
    live.record.checkpoint = { key: value.key, savedAt: valueToSave.savedAt, unsafe: false }; await snapshot(live);
    return { key: value.key, savedAt: valueToSave.savedAt };
  }
  if (method === "step-start") {
    const [nodeId, input] = args; if (typeof nodeId !== "string" || !live.record.workflow.nodes.some(n => n.id === nodeId)) throw new Error("脚本引用未声明的节点。");
    const execution = ++live.executions;
    const inputRef = await valueRef(live, input);
    const nested = context && live.open.get(context.execution ?? -1) === context.nodeId;
    if (live.stepDriver && !nested) await live.stepDriver.wait(nodeId, execution, inputRef);
    check(live); live.open.set(execution, nodeId);
    await emit(live, { kind: "node", status: "running", nodeId, execution, inputRef }); return { nodeId, execution };
  }
  if (method === "step-end" || method === "step-error") {
    const token = args[0] as { nodeId: string; execution: number };
    if (!token || live.open.get(token.execution) !== token.nodeId) throw new Error("节点执行引用已失效。");
    const outputRef = await valueRef(live, args[1]); check(live); live.open.delete(token.execution);
    await emit(live, { kind: "node", status: method === "step-end" ? "completed" : "failed", nodeId: token.nodeId, execution: token.execution, outputRef });
    await live.stepDriver?.complete(token.execution); return null;
  }
  const attached = context && live.open.get(context.execution ?? -1) === context.nodeId ? { nodeId: context.nodeId, execution: context.execution } : {};
  if (live.stepDriver && !attached.nodeId && method !== "log") throw new Error("聊天逐步执行要求将业务操作放入 ctx.step；请适配应用步骤，或明确选择整流程兼容执行。");
  if(method==="ai") {
    if(!live.detail.manifest.automation.capabilities.includes("ai")||!attached.nodeId||live.record.workflow.nodes.find(n=>n.id===attached.nodeId)?.kind!=="ai")throw new Error("只能在声明的 AI 节点调用 AI 规则。");
    if((live.aiCalls=(live.aiCalls??0)+1)>20)throw new Error("本轮 AI 判断已达到 20 次限制。");
    const rules=parseAppAiRules(await live.auth.store.privateBytes(join(live.directory,"code","ai","rules.json"),256*1024)),rule=rules[String(args[0])];if(!rule)throw new Error("AI 规则未声明。");
    live.aiAbort??=new AbortController();return executeAppAi(rule,args[1],live.aiAbort.signal,()=>check(live),{...live.record.aiSettings,model:live.record.aiModel ?? live.record.aiSettings?.model,inputOptions:args[2],readImage:ref=>live.fileOps.readImage(ref),classifierModel:live.record.aiClassifierModel ?? live.record.aiSettings?.classifierModel,onModel:async (model,operation)=>{check(live);if(operation==="classify")live.record.aiClassifierModel=model;else live.record.aiModel=model;await snapshot(live);},onUsage:async entry=>{check(live);live.record.aiUsage=[...(live.record.aiUsage??[]),entry];await emit(live,{kind:"log",status:"ai",message:`${entry.model.provider}/${entry.model.modelId}`,outputRef:await valueRef(live,entry),...attached});await snapshot(live);}});
  }
  if (method.startsWith("files.")) { if (["writeText", "writeJson", "writeBase64", "commitWriter", "mkdir", "copy", "move", "extractZip"].includes(method.slice(6))) await checkpointMutation(live); return live.fileOps.call(method.slice(6), args); }
  if (method.startsWith("tables.")) { if (method === "tables.commitWriter") await checkpointMutation(live); live.tables ??= new AppTableOperations(live.fileOps, () => check(live)); return live.tables.call(method.slice(7), args); }
  if (method.startsWith("browser.")) {
    if (!live.detail.manifest.automation.browser || !live.detail.manifest.automation.capabilities.includes("browser.read")) throw new Error("应用未声明网页能力。");
    live.browser ??= new ApplicationBrowserRuntime({ ownerKey: live.auth.ownerKey, runtimeId: live.auth.runtimeId, runId: live.record.id, detail: live.detail, store: live.auth.store,
      beforeMutation: () => checkpointMutation(live), expectedBindings: live.resumedCheckpoint?.bindings, expectedCredentials: live.resumedCheckpoint?.credentials,
      taskId: live.auth.taskId,
      captureReads: false,
      prepareUpload: async (request,input,browser) => { const directory=join(live.directory,"uploads");await live.auth.store.ensureDataDirectory(directory);if(browser&&(live.browserUploads?.length??0)>=sdkContract.limits.browserUploadSelections)throw new Error("本轮浏览器上传次数已达上限，请分批运行。");const prepared=await prepareAppUpload(live.fileOps,request,input,directory,()=>check(live),browser);if(!browser)return prepared;(live.browserUploads??=[]).push(prepared.dispose);return {input:prepared.input,dispose:async()=>{}}; },
      connection: async waiting => {
        check(live);
        if(waiting&&live.record.status==="running"||!waiting&&live.record.status==="waiting-browser"){
          live.record.status=waiting?"waiting-browser":"running";
          await emit(live,{kind:"log",status:live.record.status,message:waiting?"等待网页重新连接，运行已保留":"网页已重新连接，继续原运行",...live.browser?.eventContext});await snapshot(live);
        }
      },
      check: () => check(live),
      unknownOutcome: reason => stop(live, "interrupted", reason),
      askLogin: message => rpc(live, "ask", [[{ title: "登录或人工验证", question: message, options: [{ label: "已完成，继续", description: "重新检查当前页面及账号" }] }]], live.browser?.eventContext ?? context, true),
      showApproval: async approval => { check(live); if (approval && (live.question || live.record.browserApproval)) throw new Error("已有等待回答或授权的操作。"); if (approval) { live.record.browserApproval = approval; live.record.status = "waiting-user"; } else { delete live.record.browserApproval; live.record.status = "running"; } await emit(live, { kind: "log", status: approval ? "waiting-user" : "authorized", message: approval ? "等待首次网页变更范围授权" : "当前范围授权已保存", ...live.browser?.eventContext }); await snapshot(live); },
      saveSession: async session => { check(live); live.record.browserSessions = [...(live.record.browserSessions ?? []).filter(s => s.siteId !== session.siteId), session]; await snapshot(live); },
      audit: async (message, value) => { await emit(live, { kind: "log", status: "browser", message, ...live.browser?.eventContext, ...(value === undefined ? {} : { outputRef: await valueRef(live, value) }) }); },
    });
    if(method==="browser.download"){
      if(typeof args[3]!=="boolean"&&args[3]!==undefined)throw new Error("下载覆盖选项必须为布尔值。");
      return streamAppDownload(live.fileOps,args[2],args[3]===true,args[4],stream=>live.browser!.call("download",[args[0],args[1],stream],attached),async bytes=>{check(live);await emit(live,{kind:"log",status:"downloading",message:`下载中：${bytes} 字节`,...attached});});
    }
    return live.browser.call(method.slice(8), args, attached);
  }
  if (method === "log") { const message = String(args[0]); await emit(live, { kind: "log", status: "info", message: message.slice(0, 1000) + (message.length > 1000 ? "…（日志已截短）" : ""), ...attached }); return null; }
  if (method === "artifact" || method === "artifact-file") {
    if (!live.detail.manifest.automation.capabilities.includes("artifacts")) throw new Error("应用没有产物能力。");
    const [name, text, mediaType] = args;
    validateArtifact(name, mediaType);
    if (method === "artifact" && (typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 * 1024)) throw new Error("文字产物超过 16 MiB。");
    if (method === "artifact-file" && (live.artifactCount = (live.artifactCount ?? 0) + 1) > sdkContract.limits.artifactFiles) throw new Error("每轮最多保存 64 个文件产物。");
    await checkpointMutation(live);
    const id = randomUUID(), directory = join(live.detail.dataDirectory, "artifacts", live.record.id); await live.auth.store.ensureDataDirectory(directory);
    const target = join(directory, id); await live.auth.store.managedPath(target); check(live);
    const info = method === "artifact-file" ? await snapshotArtifact(live.fileOps, text, target, () => check(live)) : await (async () => { await writeFile(target, text as string, { flag: "wx", mode: 0o600 }); return { size: Buffer.byteLength(text as string) }; })(); check(live);
    const artifact = { id, name: name as string, mediaType: mediaType as string, ...info }; live.record.artifacts.push(artifact);
    await emit(live, { kind: "artifact", status: "created", message: artifact.name, ...attached }); await snapshot(live); return artifact;
  }
  if (method === "ask") {
    if ((!systemAsk && !live.detail.manifest.automation.capabilities.includes("clarification")) || live.question || live.record.browserApproval) throw new Error("没有澄清能力或已有待回答问题。");
    const id = randomUUID(); live.record.question = { id, questions: questions(args[0], id) }; live.record.status = "waiting-user";
    const answer = new Promise((resolve, reject) => { live.question = { id, resolve, reject }; });
    void answer.catch(() => {});
    await emit(live, { kind: "question", status: "waiting-user", ...attached }); await snapshot(live); return answer;
  }
  throw new Error("本阶段不支持此 SDK 能力。");
}
export async function startAppRun(auth: Access, appId: string, revision: number, runId: string, values: unknown, configRevision: number, actionId?: string, options?: { conversationSteps?: boolean; persistConfiguration?: boolean; isolatedWorkspace?: boolean; resumeFrom?: string; scheduleId?: string; assertScheduledSettings?: () => Promise<void> }): Promise<AppRunRecord> {
  return withDesktopUpdateAdmission(() => startAppRunInternal(auth, appId, revision, runId, values, configRevision, actionId, options));
}
async function startAppRunInternal(auth: Access, appId: string, revision: number, runId: string, values: unknown, configRevision: number, actionId?: string, options?: { conversationSteps?: boolean; persistConfiguration?: boolean; isolatedWorkspace?: boolean; resumeFrom?: string; scheduleId?: string; assertScheduledSettings?: () => Promise<void> }): Promise<AppRunRecord> {
  assertDesktopUpdateIdle();
  auth.assertExecution?.();
  if (!isAppId(runId)) fail("运行 ID 无效", 400);
  const requestedVersion=(await auth.store.detail(appId)).manifest.version;
  if (options?.resumeFrom && (!isAppId(options.resumeFrom) || options.resumeFrom === runId || auth.taskId || options.conversationSteps || options.isolatedWorkspace || options.persistConfiguration === false)) fail("检查点恢复请求无效。", 400);
  if (options?.scheduleId && (!isAppId(options.scheduleId) || auth.taskId || options.resumeFrom || options.conversationSteps || options.isolatedWorkspace || options.persistConfiguration !== false)) fail("定时运行请求无效。", 400);
  if (options?.assertScheduledSettings && !options.scheduleId) fail("定时配置核对请求无效。", 400);
  const inputHash = rawHash({ values, ...(options?.scheduleId ? { scheduleId: options.scheduleId } : {}), actionId: actionId ?? null, ...(options?.resumeFrom ? { resumeFrom: options.resumeFrom } : {}), ...(options?.conversationSteps ? { conversationSteps: true } : {}), ...(options?.isolatedWorkspace ? { isolatedWorkspace: true } : {}) });
  try {
    const previous = await getAppRun(auth, appId, runId);
    if (previous.version!==requestedVersion || previous.runtimeId !== auth.runtimeId || (previous as AppRunRecord & { inputHash?: string }).inputHash !== inputHash) fail("该运行 ID 已用于另一项请求。");
    return previous;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return auth.store.admitRun(appId, revision, async (baseDetail, pkg) => {
    if (!appActions(baseDetail).some(action => action.id === (actionId ?? appActions(baseDetail)[0]?.id))) fail("运行功能引用无效。", 400);
    const detail = appActionDetail(baseDetail, actionId);
    // A repeated HTTP submission may have waited behind the first admission.
    try { const existing = await getAppRun(auth, appId, runId); if (existing.version!==baseDetail.manifest.version || existing.runtimeId !== auth.runtimeId || (existing as AppRunRecord & { inputHash?: string }).inputHash !== inputHash) fail("运行请求已变化。"); return existing; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (runtime.live.size >= 4) fail("本机已有 4 个应用运行，请等待其中一项结束。");
    let leaseLost = false;
    if (options?.isolatedWorkspace) await auth.store.ensureDataDirectory(join(detail.dataDirectory, "execution-leases"));
    const release = await takeAppLease(detail.dataDirectory, () => { leaseLost = true; const live = runtime.live.get(runId); if (live) void stop(live, "interrupted", "执行占用已失效，运行已停止。"); }, options?.isolatedWorkspace ? runId : undefined), directory = runDirectory(auth.store, appId, runId);
    let started = false, prepared: (AppRunRecord & { inputHash: string }) | undefined;
    try {
      await options?.assertScheduledSettings?.();
      const selectedAction = actionId ?? detail.ui.buttons[0]?.id;
      if (!selectedAction || !detail.ui.buttons.some(button => button.id === selectedAction)) fail("运行按钮引用无效。", 400);
      const params = parameters(detail, values, true), grants = await new AutomationAppFiles(auth.store, detail).validateReferences(params, pkg.digest);
      const businessAi = detail.manifest.automation.capabilities.includes("ai") ? (await readBusinessAi(auth.store, appId)).settings : undefined;
      if ((await readAppConfiguration(auth, appId, detail.actionId)).revision !== configRevision) fail("配置已变化，请重新读取后启动。");
      let resumedCheckpoint: AppCheckpoint | undefined;
      if (options?.resumeFrom) {
        if (!detail.manifest.automation.checkpoints) fail("此应用未启用检查点恢复。");
        const source = await getAppRun(auth, appId, options.resumeFrom);
        if (appRunActive(source.status) || source.status === "completed" || source.isolation || source.stepControl || !source.checkpoint) fail("该运行没有可恢复的终止检查点。");
        const checkpoint = JSON.parse((await auth.store.privateBytes(join(runDirectory(auth.store, appId, source.id), "checkpoint.json"), 512 * 1024)).toString("utf8")) as AppCheckpoint;
        assertCheckpointCompatible(checkpoint, { appId, version: detail.manifest.version, digest: pkg.digest, actionId: selectedAction, paramsHash: checkpointHash(params), inputs: await checkpointInputs(grants, auth.assertIdentity) });
        if (checkpoint.aiSettingsHash && checkpoint.aiSettingsHash !== checkpointHash(businessAi)) fail("业务 AI 配置已变化，不能恢复该检查点。");
        const current = parameters(detail, (await readAppConfiguration(auth, appId, detail.actionId)).values, true);
        if (checkpointHash(current) !== checkpoint.paramsHash) fail("保存的应用配置已变化，不能恢复该检查点。");
        resumedCheckpoint = { ...checkpoint }; delete resumedCheckpoint.claimedBy;
      }
      await auth.store.ensureDataDirectory(directory); await auth.store.ensureDataDirectory(join(directory, "values"));
      // Pin the selected function's entry together with its graph and output schema.
      // The package-level entry is only the default, not the selected function.
      const entryScript = detail.manifest.automation.entry;
      const record: AppRunRecord & { inputHash: string } = { schemaVersion: 1, id: runId, appId, version: detail.manifest.version, digest: pkg.digest, runtimeId: auth.runtimeId, serverId: runtime.serverId, serverPid: process.pid, actionId: selectedAction, actionLabel: detail.ui.buttons[0]?.label, entryScript, status: "running", startedAt: new Date().toISOString(), workflow: detail.workflow, resultColumns: detail.ui.results.columns, events: [], artifacts: [], inputHash };
      if (resumedCheckpoint) { record.resumedFrom = options!.resumeFrom; record.checkpoint = { key: resumedCheckpoint.key, savedAt: resumedCheckpoint.savedAt, unsafe: false }; }
      if (businessAi) record.aiSettings = structuredClone(businessAi);
      if (options?.scheduleId) record.scheduleId = options.scheduleId;
      if (options?.isolatedWorkspace) record.isolation = "run";
      prepared = record; await auth.store.privateJson(join(directory, "run.json"), { ...record, events: [] });
      await auth.store.privateJson(join(directory, "parameters.json"), params);
      if (resumedCheckpoint) {
        await auth.store.privateJson(join(directory, "checkpoint.json"), resumedCheckpoint);
        const sourceDirectory = runDirectory(auth.store, appId, options!.resumeFrom!);
        await auth.store.privateJson(join(sourceDirectory, "checkpoint.json"), { ...resumedCheckpoint, claimedBy: runId });
        const source = await readRecordHeader(auth, appId, options!.resumeFrom!); if (source.checkpoint) source.checkpoint.claimedBy = runId;
        await auth.store.privateJson(join(sourceDirectory, "run.json"), { ...source, events: [] });
      }
      const code = join(directory, "code"), workspace = options?.isolatedWorkspace ? join(directory, "workspace") : await auth.store.ensureWorkspace(appId);
      if (options?.isolatedWorkspace) await auth.store.ensureDataDirectory(workspace);
      await auth.store.ensureDataDirectory(code);
      for (const [name, bytes] of pkg.files) { const target = join(code, ...name.split("/")); await auth.store.ensureDataDirectory(dirname(target)); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
      if (options?.persistConfiguration !== false) await saveConfiguration(auth, detail, params, configRevision, true);
      const readable = [{ path: code, kind: "directory" as const }, { path: workspace, kind: "directory" as const }, ...grants], writable = [{ path: workspace, kind: "directory" as const }, ...grants.filter(g => g.access === "readwrite")];
      const flags = ["--permission", "--max-old-space-size=256", ...automationFilePermissionFlags(readable, detail.manifest.automation.checkpoints ? [] : writable), "--input-type=module", "--eval", AUTOMATION_WORKER_SOURCE];
      auth.assertIdentity();auth.assertExecution?.(); if (leaseLost) fail("执行占用已失效，请重新启动运行。");
      const launch=await automationNodeLaunch(workspace);
      assertDesktopUpdateIdle();
      const child = spawn(launch.executable, ["--max-old-space-size=256", "--input-type=module", "--eval", AUTOMATION_SUPERVISOR_SOURCE], { cwd: launch.directory, windowsHide: true, env: { NODE_ENV: process.env.NODE_ENV ?? "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}), TEMP: workspace, TMP: workspace, LANG: "zh_CN.UTF-8" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      const closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      const live: LiveRun = { auth, detail, record, directory, child, closed, release, journal: Promise.resolve(), finishing: false, rpc: 0, executions: 0, open: new Map(), requests: new Set(), fileOps: new AppFileOperations(workspace, grants, detail.manifest.automation.capabilities, () => check(live)) };
      if (resumedCheckpoint) { live.checkpoint = structuredClone(resumedCheckpoint); live.resumedCheckpoint = resumedCheckpoint; }
      if (options?.conversationSteps) {
        record.stepControl = { mode: "conversation", pending: [] };
        live.stepDriver = new AutomationStepDriver(async (pending, current) => {
          check(live); record.stepControl = { mode: "conversation", pending, ...(current ? { current } : {}) };
          await snapshot(live);
        });
      }
      runtime.live.set(runId, live); started = true;
      const terminal = (message: { type: string; error?: string; result?: unknown }) => {
        if (live.finishing) return;
        if (live.stopKind) { void finish(live, live.stopKind, record.error); return; }
        if (message.type === "done" && !live.open.size && !live.rpc && live.executions > 0) void finish(live, "completed", undefined, message.result ?? null);
        else void finish(live, "failed", message.error ?? "脚本结束时有未完成操作，或未报告任何实际节点。");
      };
      child.on("message", (raw: unknown) => {
        if (live.finishing) return;
        try {
          if (!raw || typeof raw !== "object" || Buffer.byteLength(JSON.stringify(raw)) > 24 * 1024 * 1024) throw new Error("工作进程消息无效或过大。");
          const message = raw as { type: string; requestId: number; method: string; args: unknown[]; context: { nodeId?: string; execution?: number } | null; error?: string; result?: unknown };
          if (["done", "failed"].includes(message.type)) { terminal(message); return; }
          if (message.type !== "rpc" || !Number.isSafeInteger(message.requestId) || typeof message.method !== "string" || !Array.isArray(message.args) || live.rpc >= 64) throw new Error("SDK 请求无效或并发超过限制。");
          live.rpc++;
          const pending = rpc(live, message.method, message.args, message.context); live.requests.add(pending);
          void pending.then(value => { live.requests.delete(pending); live.rpc--; if (!live.finishing && child.connected) child.send({ type: "reply", requestId: message.requestId, value }, () => {}); }, error => { live.requests.delete(pending); live.rpc--; if (!live.finishing && child.connected) child.send({ type: "reply", requestId: message.requestId, error: errorMessage(error) }, () => {}); });
        } catch (e) { void stop(live, "failed", errorMessage(e)); }
      });
      child.once("error", e => { void finish(live, "failed", automationStartError(e)); });
      child.once("close", (code, signal) => { if (!live.finishing) void finish(live, live.stopKind ?? "interrupted", record.error ?? `工作进程退出（${code ?? signal}），结果未确认。`); });
      let consoleBytes = 0, consoleLimited = false;
      for (const pipe of [child.stdout, child.stderr]) pipe?.on("data", (chunk: Buffer) => {
        if (live.finishing || consoleLimited) return;
        consoleBytes += chunk.length;
        if (consoleBytes > 32000) { consoleLimited = true; void emit(live, { kind: "log", status: "console", message: "工作进程控制台输出超过 32 KiB，后续控制台内容不再记录。" }).catch(() => {}); return; }
        const message = chunk.toString("utf8"); void emit(live, { kind: "log", status: "console", message: message.slice(0, 1000) + (message.length > 1000 ? "…（日志已截短）" : "") }).catch(() => {});
      });
      let activeTime=0,lastTick=Date.now();
      live.watchdog = setInterval(() => { const now=Date.now();if(record.status==="running"&&(!record.stepControl||record.stepControl.current))activeTime+=now-lastTick;lastTick=now;try { auth.assertIdentity();auth.assertExecution?.(); if (activeTime > 30 * 60 * 1000) void stop(live, "failed", "实际执行超过 30 分钟，运行失败；等待网页或用户的时间不计入。"); } catch(error) { void stop(live, "interrupted", errorMessage(error)||"本地运行上下文已变化，运行已中断。"); } }, 1000);
      await emit(live, { kind: "run", status: "running", inputRef: await valueRef(live, params) });
      child.send({ type: "start", workerArgs: flags, code, workspace, entry: join(code, ...entryScript.split("/")), params, runId, actionId: selectedAction, sdk: sdkContractSummary(), checkpointMode: !!detail.manifest.automation.checkpoints }, error => { if (error) void finish(live, "failed", automationStartError(error, "ipc")); });
      return structuredClone(record);
    } catch (e) {
      const live = runtime.live.get(runId);
      if (live && !live.finishing) await finish(live, "failed", errorMessage(e));
      else if (!started && prepared) {
        prepared.status = "failed"; prepared.finishedAt = new Date().toISOString(); prepared.error = `准备脚本失败：${errorMessage(e)}`;
        try { const event: AppRunEvent = { seq: 1, runId, at: prepared.finishedAt, kind: "run", status: "failed", message: prepared.error }; await appendFile(join(directory, "events.jsonl"), JSON.stringify(event) + "\n"); await auth.store.privateJson(join(directory, "run.json"), { ...prepared, events: [] }); } catch { /* Storage or identity is unavailable; no worker was started. */ }
      }
      throw e;
    }
    finally { if (!started) await release(); }
  });
}
function ownedLive(auth: Access, appId: string, id: string) {
  const live = runtime.live.get(id);
  if (!live || live.auth.ownerKey !== auth.ownerKey || live.record.appId !== appId || live.record.runtimeId !== auth.runtimeId || live.auth.store.base!==auth.store.base) fail("当前运行已结束、已中断或属于其他本地工作区。");
  return live;
}
export async function advanceAppRun(auth: Access, appId: string, id: string, stepToken: string) {
  const live = ownedLive(auth, appId, id); check(live);
  if (!live.stepDriver || typeof stepToken !== "string") fail("当前运行不支持逐步调度，请读取原运行状态。");
  await live.stepDriver.advance(stepToken);
  return getAppRun(auth, appId, id);
}
export async function stopAppRun(auth: Access, appId: string, id: string) {
  const live = runtime.live.get(id);
  if (!live) {
    const install = await auth.store.find(appId); if (!install) return getAppRun(auth, appId, id);
    return auth.store.admitRun(appId, install.revision, async () => { const prepared = runtime.live.get(id); if (prepared) { const owned = ownedLive(auth, appId, id); await stop(owned, "cancelled", "用户停止运行。"); return structuredClone(owned.record); } return getAppRun(auth, appId, id); }, false);
  }
  const owned = ownedLive(auth, appId, id); await stop(owned, "cancelled", "用户停止运行；未确认完成的操作不会自动重试。"); return structuredClone(owned.record);
}
export async function answerAppRun(auth: Access, appId: string, id: string, questionId: string, responses: UserInputResponse[]) {
  const live = ownedLive(auth, appId, id), group = live.record.question, waiter = live.question; check(live);
  if (!group || group.id !== questionId || waiter?.id !== questionId || waiter.answering || !Array.isArray(responses) || responses.length !== group.questions.length || new Set(responses.map(r => r.questionId)).size !== responses.length) fail("问题已变化、正在提交或答案不完整。");
  const answers = group.questions.map(question => { const response = responses.find(r => r.questionId === question.id); if (!response) fail("请回答全部问题。", 400); return { questionId: question.id, ...validateUserInputResponse(question, response) }; });
  waiter.answering = true;
  try {
    live.record.status = "running";
    await emit(live, { kind: "question", status: "answered", outputRef: await valueRef(live, answers) });
    delete live.record.question; await snapshot(live); check(live);
    live.question = undefined; waiter.resolve(answers); return structuredClone(live.record);
  } catch (e) { waiter.reject(e instanceof Error ? e : new Error(String(e))); live.question = undefined; void stop(live, "failed", "答案保存失败，运行已停止。"); throw e; }
}
export async function appRunValue(auth: Access, appId: string, runId: string, ref: string) {
  const record = await getAppRun(auth, appId, runId);
  if (!/^[a-f0-9-]{36}\.json$/.test(ref) || (record.resultRef !== ref && !record.events.some(e => e.inputRef === ref || e.outputRef === ref)
    && !record.stepControl?.pending.some(step => step.inputRef === ref) && record.stepControl?.current?.inputRef !== ref)) fail("数据引用不存在。", 404);
  const value = JSON.parse((await auth.store.privateBytes(join(runDirectory(auth.store, appId, runId), "values", ref), APP_EXECUTION_VALUE_MAX_BYTES)).toString("utf8")); auth.assertIdentity(); return value;
}
export async function appRunArtifact(auth: Access, appId: string, runId: string, artifactId: string) {
  const record = await getAppRun(auth, appId, runId), artifact = record.artifacts.find(a => a.id === artifactId); if (!artifact || !isAppId(artifactId)) fail("产物不存在。", 404);
  const bytes = await auth.store.privateBytes(join(auth.store.dataDirectory(appId), "artifacts", runId, artifactId), 16 * 1024 * 1024); auth.assertIdentity(); return { bytes, artifact };
}
export async function appRunArtifactStream(auth: Access, appId: string, runId: string, artifactId: string) {
  const record = await getAppRun(auth, appId, runId), artifact = record.artifacts.find(a => a.id === artifactId);
  if (!artifact || !isAppId(artifactId)) fail("产物不存在。", 404);
  const path = join(auth.store.dataDirectory(appId), "artifacts", runId, artifactId); await auth.store.managedPath(path);
  const stream = await streamArtifact(path, artifact.size, auth.assertIdentity); return { stream, artifact };
}
export async function appBrowserSpec(auth: Access, appId: string, runId: string, siteId: string) {
  if (!await auth.store.find(appId)) fail("应用已卸载。");
  const record = await getAppRun(auth, appId, runId);
  if (record.runtimeId !== auth.runtimeId) fail("网页运行属于其他本地工作区。");
  const session = record.browserSessions?.find(s => s.siteId === siteId); if (!session) fail("此运行尚未打开该网站。");
  return session.native;
}
/** Called only after the managing plugin has actually been disabled/removed. */
export async function interruptManagedApplicationRuns(ownerKey:string,appId:string) {
  const runs=[...runtime.live.values()].filter(live=>live.auth.ownerKey===ownerKey&&live.record.appId===appId&&!live.auth.taskId);
  await Promise.all(runs.map(live=>stop(live,"interrupted","所属组织插件已停用或卸载，运行已中断。")));
  const deadline=Date.now()+10000;
  while(runs.some(live=>runtime.live.has(live.record.id))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(runs.some(live=>runtime.live.has(live.record.id)))fail("插件已停止提供执行权限，后台进程仍在结束，请稍后刷新。");
}
