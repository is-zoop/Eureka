import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AutomationAppDetail } from "./automation-app";
import { isAppId } from "./automation-app";
import { AutomationAppError } from "./automation-app-package";
import type { AutomationAppStore } from "./automation-app-store";
import { AppFileOperations, AutomationAppFiles } from "./automation-app-files";
import { appHasLease, takeAppLease } from "./automation-app-lease";
import { appJsonValue, appParameters, appRunActive, newestAppRuns, type AppConfiguration, type AppRunEvent, type AppRunRecord, type AppRunStatus } from "./automation-app-run";
import { validateUserInputResponse, type UserInputQuestion, type UserInputResponse } from "./user-input";
import { AUTOMATION_WORKER_SOURCE, AUTOMATION_SUPERVISOR_SOURCE } from "./automation-app-worker";
import lockfile from "proper-lockfile";
import { ApplicationBrowserRuntime } from "./automation-app-browser-runtime";
import { executeAppAi, parseAppAiRules } from "./automation-app-ai";
import { automationNodeLaunch,automationStartError,automationFilePermissionFlags } from "./automation-node-runtime";

type Access = { ownerKey: string; runtimeId: string; store: AutomationAppStore; assertIdentity: () => void; assertExecution?:()=>void; taskId?: string };
interface LiveRun {
  auth: Access; detail: AutomationAppDetail; record: AppRunRecord; directory: string; child: ChildProcess;
  closed: Promise<void>; release: () => Promise<void>; journal: Promise<void>; finishing: boolean; rpc: number; executions: number;
  open: Map<number, string>; fileOps: AppFileOperations; stopKind?: "cancelled" | "failed" | "interrupted";
  requests: Set<Promise<unknown>>;
  browser?: ApplicationBrowserRuntime;
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
function emit(live: LiveRun, event: Omit<AppRunEvent, "seq" | "at" | "runId">) {
  const job = live.journal.then(async () => {
    if (live.record.events.length >= 2500 && event.kind !== "run") throw new Error("运行事件超过 2500 条限制。");
    const item: AppRunEvent = { ...event, seq: live.record.events.length + 1, at: new Date().toISOString(), runId: live.record.id };
    await appendFile(join(live.directory, "events.jsonl"), JSON.stringify(item) + "\n", { mode: 0o600 }); live.record.events.push(item);
  });
  live.journal = job.catch(() => {}); return job;
}
async function valueRef(live: LiveRun, value: unknown) {
  const clean = appJsonValue(value), ref = `${randomUUID()}.json`;
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
  if (reconcile && appRunActive(record.status) && !runtime.live.has(id) && (!serverExists(record.serverPid) || !await appHasLease(auth.store.dataDirectory(appId)))) {
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
export async function readAppConfiguration(auth: Access, appId: string): Promise<AppConfiguration> {
  if (!await auth.store.find(appId)) fail("应用未安装", 404);
  try { const raw = JSON.parse((await auth.store.privateBytes(join(auth.store.dataDirectory(appId), "config.json"), 1024 * 1024)).toString("utf8")); if (raw.schemaVersion !== 1 || !raw.values || typeof raw.values !== "object" || Array.isArray(raw.values)) fail("配置文件无效。"); return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, values: raw.values }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, revision: 0, values: {} }; throw e; }
}
async function saveConfiguration(auth: Access, detail: AutomationAppDetail, values: unknown, revision: number, required: boolean) {
  const current = await readAppConfiguration(auth, detail.install.id); if (current.revision !== revision) fail("配置已变化，请重新读取后保存。");
  const configuration: AppConfiguration = { schemaVersion: 1, revision: revision + 1, values: parameters(detail, values, required) };
  try { appJsonValue(configuration.values, 512 * 1024); } catch { fail("配置超过 512 KiB，请将大量数据作为文件输入。", 400); }
  await auth.store.privateJson(join(detail.dataDirectory, "config.json"), configuration); return configuration;
}
export async function saveAppConfiguration(auth: Access, appId: string, revision: number, configRevision: number, values: unknown) {
  return auth.store.admitRun(appId, revision, detail => saveConfiguration(auth, detail, values, configRevision, false), false);
}
export async function grantAppFile(auth: Access, appId: string, revision: number, fieldId: string, path: string, access: "read" | "readwrite") {
  return auth.store.admitRun(appId, revision, detail => new AutomationAppFiles(auth.store, detail).grant(fieldId, path, access), false);
}
export async function listAppRuns(auth: Access, appId: string) {
  const root = join(auth.store.dataDirectory(appId), "logs", "runs"); await auth.store.managedPath(root);
  let ids: string[]; try { ids = (await readdir(root)).filter(isAppId); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  // Read only headers to select the newest runs; load event logs for that page only.
  const dated = await Promise.all(ids.map(async id => {
    try { const record = await readRecordHeader(auth, appId, id); return { id, startedAt: record.startedAt }; }
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
    try { await live.release(); } catch { /* Lost or stale lease; no work is resumed. */ } finally { runtime.live.delete(live.record.id); }
  }
}
async function stop(live: LiveRun, kind: "cancelled" | "failed" | "interrupted", reason: string) {
  if (live.finishing || live.stopKind) return;
  live.stopKind = kind; live.record.status = "cancelling"; live.record.error = reason;
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
  if (method === "step-start") {
    const [nodeId, input] = args; if (typeof nodeId !== "string" || !live.record.workflow.nodes.some(n => n.id === nodeId)) throw new Error("脚本引用未声明的节点。");
    const execution = ++live.executions; live.open.set(execution, nodeId);
    const inputRef = await valueRef(live, input); await emit(live, { kind: "node", status: "running", nodeId, execution, inputRef }); return { nodeId, execution };
  }
  if (method === "step-end" || method === "step-error") {
    const token = args[0] as { nodeId: string; execution: number };
    if (!token || live.open.get(token.execution) !== token.nodeId) throw new Error("节点执行引用已失效。");
    const outputRef = await valueRef(live, args[1]); check(live); live.open.delete(token.execution);
    await emit(live, { kind: "node", status: method === "step-end" ? "completed" : "failed", nodeId: token.nodeId, execution: token.execution, outputRef }); return null;
  }
  const attached = context && live.open.get(context.execution ?? -1) === context.nodeId ? { nodeId: context.nodeId, execution: context.execution } : {};
  if(method==="ai") {
    if(!live.detail.manifest.automation.capabilities.includes("ai")||!attached.nodeId||live.record.workflow.nodes.find(n=>n.id===attached.nodeId)?.kind!=="ai")throw new Error("只能在声明的 AI 节点调用 AI 规则。");
    if((live.aiCalls=(live.aiCalls??0)+1)>20)throw new Error("本轮 AI 判断已达到 20 次限制。");
    const rules=parseAppAiRules(await live.auth.store.privateBytes(join(live.directory,"code","ai","rules.json"),256*1024)),rule=rules[String(args[0])];if(!rule)throw new Error("AI 规则未声明。");
    live.aiAbort??=new AbortController();return executeAppAi(rule,args[1],live.aiAbort.signal,()=>check(live),{inputOptions:args[2],readImage:ref=>live.fileOps.readImage(ref)});
  }
  if (method.startsWith("files.")) return live.fileOps.call(method.slice(6), args);
  if (method.startsWith("browser.")) {
    if (!live.detail.manifest.automation.browser || !live.detail.manifest.automation.capabilities.includes("browser.read")) throw new Error("应用未声明网页能力。");
    live.browser ??= new ApplicationBrowserRuntime({ ownerKey: live.auth.ownerKey, runtimeId: live.auth.runtimeId, runId: live.record.id, detail: live.detail, store: live.auth.store,
      taskId: live.auth.taskId,
      captureReads: Boolean(live.auth.taskId),
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
    return live.browser.call(method.slice(8), args, attached);
  }
  if (method === "log") { const message = String(args[0]); await emit(live, { kind: "log", status: "info", message: message.slice(0, 1000) + (message.length > 1000 ? "…（日志已截短）" : ""), ...attached }); return null; }
  if (method === "artifact") {
    if (!live.detail.manifest.automation.capabilities.includes("artifacts")) throw new Error("应用没有产物能力。");
    const [name, text, mediaType] = args;
    if (typeof name !== "string" || !/^[^\\/<>:"|?*\x00-\x1f]{1,120}$/.test(name) || /[. ]$/.test(name) || typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 * 1024 || typeof mediaType !== "string" || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;charset=utf-8)?$/.test(mediaType)) throw new Error("产物名称、类型或大小无效。");
    const id = randomUUID(), directory = join(live.detail.dataDirectory, "artifacts", live.record.id); await live.auth.store.ensureDataDirectory(directory);
    const target = join(directory, id); await live.auth.store.managedPath(target); check(live); await writeFile(target, text, { flag: "wx", mode: 0o600 }); check(live);
    const artifact = { id, name, mediaType, size: Buffer.byteLength(text) }; live.record.artifacts.push(artifact);
    await emit(live, { kind: "artifact", status: "created", message: name, ...attached }); await snapshot(live); return artifact;
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
export async function startAppRun(auth: Access, appId: string, revision: number, runId: string, values: unknown, configRevision: number, actionId?: string): Promise<AppRunRecord> {
  auth.assertExecution?.();
  if (!isAppId(runId)) fail("运行 ID 无效", 400);
  const inputHash = rawHash({ values, actionId: actionId ?? null });
  try {
    const previous = await getAppRun(auth, appId, runId);
    if (previous.runtimeId !== auth.runtimeId || (previous as AppRunRecord & { inputHash?: string }).inputHash !== inputHash) fail("该运行 ID 已用于另一项请求。");
    return previous;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return auth.store.admitRun(appId, revision, async (detail, pkg) => {
    // A repeated HTTP submission may have waited behind the first admission.
    try { const existing = await getAppRun(auth, appId, runId); if (existing.runtimeId !== auth.runtimeId || (existing as AppRunRecord & { inputHash?: string }).inputHash !== inputHash) fail("运行请求已变化。"); return existing; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (runtime.live.size >= 4) fail("本机已有 4 个应用运行，请等待其中一项结束。");
    let leaseLost = false;
    const release = await takeAppLease(detail.dataDirectory, () => { leaseLost = true; const live = runtime.live.get(runId); if (live) void stop(live, "interrupted", "执行占用已失效，运行已停止。"); }), directory = runDirectory(auth.store, appId, runId);
    let started = false, prepared: (AppRunRecord & { inputHash: string }) | undefined;
    try {
      const selectedAction = actionId ?? detail.ui.buttons[0]?.id;
      if (!selectedAction || !detail.ui.buttons.some(button => button.id === selectedAction)) fail("运行按钮引用无效。", 400);
      const params = parameters(detail, values, true), grants = await new AutomationAppFiles(auth.store, detail).validateReferences(params, pkg.digest);
      if ((await readAppConfiguration(auth, appId)).revision !== configRevision) fail("配置已变化，请重新读取后启动。");
      await auth.store.ensureDataDirectory(directory); await auth.store.ensureDataDirectory(join(directory, "values"));
      const record: AppRunRecord & { inputHash: string } = { schemaVersion: 1, id: runId, appId, version: detail.manifest.version, digest: pkg.digest, runtimeId: auth.runtimeId, serverId: runtime.serverId, serverPid: process.pid, actionId: selectedAction, status: "running", startedAt: new Date().toISOString(), workflow: detail.workflow, resultColumns: detail.ui.results.columns, events: [], artifacts: [], inputHash };
      prepared = record; await auth.store.privateJson(join(directory, "run.json"), { ...record, events: [] });
      const code = join(directory, "code"), workspace = await auth.store.ensureWorkspace(appId);
      await auth.store.ensureDataDirectory(code);
      for (const [name, bytes] of pkg.files) { const target = join(code, ...name.split("/")); await auth.store.ensureDataDirectory(dirname(target)); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
      await saveConfiguration(auth, detail, params, configRevision, true);
      const readable = [{ path: code, kind: "directory" as const }, { path: workspace, kind: "directory" as const }, ...grants], writable = [{ path: workspace, kind: "directory" as const }, ...grants.filter(g => g.access === "readwrite")];
      const flags = ["--permission", "--max-old-space-size=256", ...automationFilePermissionFlags(readable, writable), "--input-type=module", "--eval", AUTOMATION_WORKER_SOURCE];
      auth.assertIdentity();auth.assertExecution?.(); if (leaseLost) fail("执行占用已失效，请重新启动运行。");
      const launch=await automationNodeLaunch(workspace);
      const child = spawn(launch.executable, ["--max-old-space-size=256", "--input-type=module", "--eval", AUTOMATION_SUPERVISOR_SOURCE], { cwd: launch.directory, windowsHide: true, env: { NODE_ENV: process.env.NODE_ENV ?? "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}), TEMP: workspace, TMP: workspace, LANG: "zh_CN.UTF-8" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      const closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      const live: LiveRun = { auth, detail, record, directory, child, closed, release, journal: Promise.resolve(), finishing: false, rpc: 0, executions: 0, open: new Map(), requests: new Set(), fileOps: new AppFileOperations(workspace, grants, detail.manifest.automation.capabilities, () => check(live)) };
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
      live.watchdog = setInterval(() => { const now=Date.now();if(record.status==="running")activeTime+=now-lastTick;lastTick=now;try { auth.assertIdentity();auth.assertExecution?.(); if (activeTime > 30 * 60 * 1000) void stop(live, "failed", "实际执行超过 30 分钟，运行失败；等待网页或用户的时间不计入。"); } catch(error) { void stop(live, "interrupted", errorMessage(error)||"登录身份已变化，运行已中断。"); } }, 1000);
      await emit(live, { kind: "run", status: "running", inputRef: await valueRef(live, params) });
      child.send({ type: "start", workerArgs: flags, code, workspace, entry: join(code, ...pkg.manifest.automation.entry.split("/")), params, runId, actionId: selectedAction }, error => { if (error) void finish(live, "failed", automationStartError(error, "ipc")); });
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
  if (!live || live.auth.ownerKey !== auth.ownerKey || live.record.appId !== appId || live.record.runtimeId !== auth.runtimeId || live.auth.store.base!==auth.store.base) fail("当前运行已结束、已中断或属于其他登录代次。");
  return live;
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
  if (!/^[a-f0-9-]{36}\.json$/.test(ref) || (record.resultRef !== ref && !record.events.some(e => e.inputRef === ref || e.outputRef === ref))) fail("数据引用不存在。", 404);
  const value = JSON.parse((await auth.store.privateBytes(join(runDirectory(auth.store, appId, runId), "values", ref), 2 * 1024 * 1024)).toString("utf8")); auth.assertIdentity(); return value;
}
export async function appRunArtifact(auth: Access, appId: string, runId: string, artifactId: string) {
  const record = await getAppRun(auth, appId, runId), artifact = record.artifacts.find(a => a.id === artifactId); if (!artifact || !isAppId(artifactId)) fail("产物不存在。", 404);
  const bytes = await auth.store.privateBytes(join(auth.store.dataDirectory(appId), "artifacts", runId, artifactId), 16 * 1024 * 1024); auth.assertIdentity(); return { bytes, artifact };
}
export async function appBrowserSpec(auth: Access, appId: string, runId: string, siteId: string) {
  if (!await auth.store.find(appId)) fail("应用已卸载。");
  const record = await getAppRun(auth, appId, runId);
  if (record.runtimeId !== auth.runtimeId) fail("网页运行属于其他登录代次。");
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
