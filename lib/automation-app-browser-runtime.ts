import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { AutomationAppDetail } from "./automation-app";
import { appBrowserSessionId, appSiteAllows, parseAppLocator, parseAppPageField, type AppBrowserApproval, type AppBrowserBinding, type AppBrowserSite, type AppWebGrant, type AppWebOperation } from "./automation-app-browser";
import { appJsonValue, type AppJson } from "./automation-app-run";
import type { AutomationAppStore } from "./automation-app-store";
import { AutomationAppError } from "./automation-app-package";
import type { NativeBrowserSpec } from "./native-browser";

export interface AppBrowserSession { siteId: string; native: NativeBrowserSpec }
interface Options {
  taskId?: string;
  captureReads?: boolean;
  connection?: (waiting: boolean) => Promise<void>;
  ownerKey: string; runtimeId: string; runId: string; detail: AutomationAppDetail; store: AutomationAppStore;
  check: () => void; askLogin: (message: string) => Promise<unknown>;
  showApproval: (approval: AppBrowserApproval | null) => Promise<void>;
  saveSession: (session: AppBrowserSession) => Promise<void>;
  audit: (message: string, value?: unknown) => Promise<void>;
  unknownOutcome: (reason: string) => Promise<void>;
}
interface Command {
  id: string; method: string; payload: string; siteId: string; native: NativeBrowserSpec;
  expiresAt: number; phase: "pending" | "claimed" | "armed" | "dispatched" | "done" | "cancelled";
  bridgeId?: string; lease?: string; operation?: AppWebOperation; result?: unknown; error?: string; dispatched?: boolean;
}
type Ticket = { service: ApplicationBrowserRuntime; command: Command; expiresAt: number; payload: string; lease:string; bridgeId:string };
const shared = globalThis as typeof globalThis & { __eurekaAppWeb?: { services: Map<string, ApplicationBrowserRuntime>; tickets: Map<string, Ticket> } };
const globalWeb = shared.__eurekaAppWeb ??= { services: new Map<string, ApplicationBrowserRuntime>(), tickets: new Map<string, Ticket>() };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fail(message: string): never { throw new AutomationAppError(message, 409); }
export class ApplicationBrowserRuntime {
  eventContext: { nodeId?: string; execution?: number } = {};
  private closed = false;
  private commands = new Map<string, Command>();
  private binding: AppBrowserBinding | null = null;
  private activeSite: AppBrowserSite | null = null;
  private sessions = new Map<string, AppBrowserSession>();
  private bridge: { id: string; at: number; available: boolean } | null = null;
  private waitingConnection = false;
  private openedSites = new Set<string>();
  private lane: Promise<unknown> = Promise.resolve();
  private readEvidence = new Map<string,string>();
  private readEvidenceCount = 0;
  private readEvidenceOmitted = false;
  private approval: { value: AppBrowserApproval; resolve: () => void; reject: (e: Error) => void; busy?: boolean } | null = null;
  constructor(readonly options: Options) { globalWeb.services.set(options.runId, this); }
  private check() { this.options.check(); if (this.closed) fail("网页运行已停止，不会重放任何操作。"); }
  get nativeSession() { return this.activeSite ? this.sessions.get(this.activeSite.id)?.native : undefined; }
  get hasOpened() { return Boolean(this.activeSite&&this.openedSites.has(this.activeSite.id)&&![...this.commands.values()].some(command=>command.siteId===this.activeSite!.id&&command.method==="open"&&!["done","cancelled"].includes(command.phase))); }
  private connected() { return Boolean(this.bridge?.available && Date.now()-this.bridge.at<15000); }
  private async connection(waiting:boolean) { if(this.waitingConnection===waiting)return;this.waitingConnection=waiting;await this.options.connection?.(waiting); }
  private reconnectCommand(command:Command) {
    // Only reads are repeatable after dispatch. Never replay a click, fill,
    // navigation or other operation whose native execution already began.
    if(command.phase==="done"||command.phase==="cancelled"||command.phase==="dispatched"&&!["probe","observe","locate","read","extract"].includes(command.method))return;
    for(const [token,ticket] of globalWeb.tickets)if(ticket.service===this&&ticket.command===command)globalWeb.tickets.delete(token);
    command.phase="pending";delete command.bridgeId;delete command.lease;command.dispatched=false;command.expiresAt=Date.now()+60000;
  }
  async detach(bridgeId:string) { this.check();if(this.bridge?.id!==bridgeId)return;this.bridge=null;for(const command of this.commands.values())this.reconnectCommand(command);if([...this.commands.values()].some(command=>!["done","cancelled"].includes(command.phase)))await this.connection(true); }
  async connectionFailed(reason:string) { await this.interrupt(reason); }
  async defer(id:string,lease:string,bridgeId:string) {
    const command=this.current(id,lease);if(command.bridgeId!==bridgeId)fail("网页命令不属于当前连接。");
    this.reconnectCommand(command);
    const deferred=command.phase==="pending";if(deferred)await this.connection(true);
    return {deferred};
  }
  private async captureRead(method: "read" | "extract", site: AppBrowserSite, args: unknown, value: unknown) {
    if (!this.options.captureReads) return value;
    const key = hash([site.id,method,args]), fingerprint = hash(value);
    if (this.readEvidence.get(key) === fingerprint) return value;
    const record = { method, siteId:site.id, args, value };
    if (this.readEvidenceCount >= 120 || Buffer.byteLength(JSON.stringify(record)) > 256000) {
      if (!this.readEvidenceOmitted) { await this.options.audit("网页字段证据超过保存范围，部分读取未纳入校验；请缩小读取范围。"); this.readEvidenceOmitted = true; }
      return value;
    }
    await this.options.audit("已记录网页字段证据", record);
    this.readEvidence.set(key,fingerprint); this.readEvidenceCount++;
    return value;
  }
  private async interrupt(reason: string) { if (this.closed) return; this.close(reason); await this.options.unknownOutcome(reason); }
  private site(id?: unknown) { const site = this.options.detail.manifest.automation.browser?.sites.find(s => s.id === (id ?? this.options.detail.manifest.automation.browser?.sites[0]?.id)); if (!site) fail("网站未在当前应用中声明。"); return site; }
  private get digest() { return this.options.detail.install.versions.find(v => v.version === this.options.detail.manifest.version)!.digest; }
  private get grantsFile() { return join(this.options.detail.dataDirectory, "browser-grants.json"); }
  async grants(): Promise<AppWebGrant[]> {
    try { const raw = JSON.parse((await this.options.store.privateBytes(this.grantsFile, 512 * 1024)).toString("utf8")); if (raw.schemaVersion !== 1 || !Array.isArray(raw.grants)) fail("网页授权文件不可读取。"); return raw.grants; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  }
  private async hasGrant(site: AppBrowserSite, op: AppWebOperation) {
    if (!this.binding?.account) return false;
    return (await this.grants()).some(g => !g.revokedAt && g.digest === this.digest && g.siteId === site.id && g.origin === this.binding!.origin && g.environment === this.binding!.environment && g.accountHash === this.binding!.accountHash && g.operationId === op.id && g.scopeHash === hash(op));
  }
  async session(site: AppBrowserSite) {
    const old = this.sessions.get(site.id); if (old) return old;
    let environmentId = "00000000000000000000000000000000";
    try { const raw = JSON.parse((await this.options.store.privateBytes(join(this.options.detail.dataDirectory, "browser-settings.json"), 8192)).toString("utf8")); environmentId = raw.environments?.[site.id] ?? environmentId; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (typeof environmentId!=="string" || environmentId !== "temporary" && !/^[a-f0-9]{32}$/.test(environmentId)) fail("浏览环境引用无效。");
    // Task identity changes per run; the native profile is reused separately by
    // owner/environment. Late close/pause calls must not reach the next run.
    const native: NativeBrowserSpec = { ownerKey: this.options.ownerKey, sessionId: appBrowserSessionId(hash([this.options.detail.install.id, this.options.runId, site.id])), websiteUrl: site.startUrl, applicationId: this.options.detail.install.id, applicationRunId: this.options.runId, applicationSiteId: site.id, ...(this.options.taskId?{applicationTaskId:this.options.taskId}:{}), ...(environmentId === "temporary" ? { browserMode: "temporary" as const } : { accountId: environmentId }) };
    const session = { siteId: site.id, native }; this.sessions.set(site.id, session); await this.options.saveSession(session); return session;
  }
  private async command(method: string, site: AppBrowserSite, args: Record<string, unknown> = {}, operation?: AppWebOperation) {
    this.check(); const { native } = await this.session(site);
    const payload = JSON.stringify({ method, site, args, expected: this.binding?.siteId === site.id ? { account: this.binding.account, environment: this.binding.environment } : null });
    if (Buffer.byteLength(payload) > 100000) fail("网页请求过大，请缩小读取范围。");
    const c: Command = { id: randomUUID(), method, payload, siteId: site.id, native, expiresAt: Date.now() + 60000, phase: "pending", operation }; this.commands.set(c.id, c);
    try {
      for (;;) {
        this.check();
        if (c.phase === "cancelled") fail("网页步骤已取消；请核对页面，不自动重试。");
        if (c.phase === "done") { await this.connection(false);if (c.error) fail(c.error); if (c.result && typeof c.result === "object" && (c.result as { error?: unknown }).error) fail(String((c.result as { error: unknown }).error)); return c.result; }
        if(!this.connected()) {
          this.reconnectCommand(c);await this.connection(true);
          if(c.phase!=="dispatched")c.expiresAt=Date.now()+60000;
        } else await this.connection(false);
        if(Date.now()>=c.expiresAt)break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      fail(c.phase === "dispatched" ? "网页请求已经派发，但结果未知；请人工核对，不自动重试。" : "网页面板连接超时，未收到本次运行的操作回执；这不是等待用户回答。请保持当前对话及侧边浏览器可见。");
    } catch (e) {
      if (c.dispatched && c.operation?.effect === "mutation") await this.interrupt("网页变更可能已执行，但结果未确认；已中断运行，请人工核对，不会自动重试。");
      throw e;
    } finally { if (c.phase !== "done") c.phase = "cancelled"; }
  }
  presence(bridgeId: string, available = true) {
    this.check();
    if (this.bridge && this.bridge.id !== bridgeId && Date.now()-this.bridge.at<15000) return null;
    if(this.bridge?.id!==bridgeId||!available)for(const command of this.commands.values())this.reconnectCommand(command);
    this.bridge = { id: bridgeId, at: Date.now(), available };
    return available ? [...this.commands.values()].find(c => c.phase === "pending" && c.expiresAt > Date.now()) ?? null : null;
  }
  claim(id: string, bridgeId: string) { this.check(); const c = this.commands.get(id); if (!c || c.phase !== "pending" || !this.connected() || this.bridge?.id !== bridgeId || c.expiresAt < Date.now()) fail("网页命令已失效。"); c.phase = "claimed"; c.bridgeId = bridgeId; c.lease = randomUUID(); return { lease: c.lease, command: { id: c.id, method: c.method, payload: c.payload, native: c.native, expiresAt: c.expiresAt } }; }
  private current(id: string, lease: string) { this.check(); const c = this.commands.get(id); if (!c || c.lease !== lease || c.expiresAt < Date.now() || c.phase === "cancelled" || c.phase === "done") fail("网页命令已失效。"); return c; }
  async arm(id: string, lease: string) {
    const c = this.current(id, lease); if (c.phase !== "claimed") fail("网页命令不能重复派发。");
    await this.policy(c); if(this.current(id,lease).phase!=="claimed")fail("网页命令已经完成或被取消，不能再次派发。"); c.phase = "armed"; const token = randomBytes(32).toString("hex");
    for (const [key, ticket] of globalWeb.tickets) if (ticket.expiresAt < Date.now()) globalWeb.tickets.delete(key);
    globalWeb.tickets.set(token, { service: this, command: c, expiresAt: Date.now() + 15000, payload: c.payload,lease,bridgeId:c.bridgeId! }); return token;
  }
  async policy(c: Command) {
    this.check(); if (c.expiresAt < Date.now() || c.phase === "cancelled" || !this.connected() || this.bridge!.id !== c.bridgeId) fail("网页请求或面板连接已失效。");
    if (c.operation?.effect === "mutation" && !await this.hasGrant(this.site(c.siteId), c.operation)) fail("网页变更授权已撤销或范围已变化。");
    this.check();
  }
  complete(id: string, lease: string, result: unknown, error?: string) {
    const c = this.current(id, lease); if (c.phase !== "dispatched" && !(c.phase === "claimed" && (["open", "release"].includes(c.method) || error)) && !(c.phase === "armed" && error)) fail("网页结果不属于已派发操作。");
    if (error) c.error = error.slice(0, 1500); else { c.result = appJsonValue(result); if(c.method==="open")this.openedSites.add(c.siteId); } c.phase = "done";
  }
  private async probe(site: AppBrowserSite, allowLogin = false, settleUntil = allowLogin ? Date.now() + 5000 : 0): Promise<AppBrowserBinding> {
    type Probe = { origin: string; environment: string; account: string | null; outOfScope?: boolean; authRequired?: boolean; error?: string };
    let value: Probe;
    try { value = await this.command("probe", site) as Probe; }
    catch (error) {
      // Only initial, read-only identity checks may wait for the page to load.
      // Never replay an operation, a stopped task or an authorization failure.
      if (!allowLogin || !(error instanceof Error) || !error.message.includes("网页正在加载")) throw error;
      if (Date.now() >= settleUntil) {
        await this.command("release", site);
        await this.options.askLogin(`“${site.label}”的页面仍未就绪。请在右侧确认登录或人工验证已完成，返回应用入口页面后继续。`);
        return this.probe(site);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      this.check(); return this.probe(site, allowLogin, settleUntil);
    }
    if (!value || value.error || typeof value.environment !== "string" || value.environment.length > 200 || (value.account !== null && (typeof value.account !== "string" || value.account.length > 300)) || (value.authRequired !== undefined && typeof value.authRequired !== "boolean")) fail(value?.error ?? "当前网页身份不可确认。");
    if (allowLogin && Date.now() < settleUntil && (value.authRequired || value.outOfScope || value.origin !== new URL(site.startUrl).origin || site.account && !value.account)) {
      await new Promise(resolve => setTimeout(resolve, 300));
      this.check(); return this.probe(site, allowLogin, settleUntil);
    }
    if (value.authRequired || value.outOfScope || value.origin !== new URL(site.startUrl).origin) {
      if (allowLogin) { await this.command("release", site); await this.options.askLogin(`请在右侧完成“${site.label}”的登录或人工验证，并返回应用入口页面后继续。`); return this.probe(site); }
      fail(value.authRequired ? "登录或人工验证尚未完成，请核对右侧页面后重新连接。" : "当前页面不在声明的网站范围，请返回应用入口页面。");
    }
    return { siteId: site.id, origin: value.origin, environment: value.environment, account: value.account, accountHash: hash([value.origin, value.environment, value.account]) };
  }
  async call(method: string, args: unknown[], context: { nodeId?: string; execution?: number } = {}) {
    const task = this.lane.catch(() => {}).then(async () => {
      this.eventContext = context;
      this.check();
      if (method === "connect") {
        const site = this.site(args[0]); this.activeSite = site; this.binding = null;
        await this.command("open", site); let binding = await this.probe(site, true);
        if (site.account && !binding.account) { await this.command("release", site); await this.options.askLogin(`请在右侧完成“${site.label}”的登录或人工验证，确认账号后继续。`); binding = await this.probe(site); }
        if (site.account && !binding.account) fail("仍未读取到账号标记，请核对登录及应用中的账号定位规则。");
        this.binding = binding; await this.options.audit("已连接网站与当前账号环境", binding); return binding;
      }
      const site = this.activeSite; if (!site || !this.binding) fail("请先调用 browser.connect 连接网站。");
      if (method === "release") { await this.command("release", site); return { released: true }; }
      if (method === "observe") return (await this.command("observe",site) as {value:unknown}).value;
      if (method === "operation") {
        const op = site.operations.find(o => o.id === args[0]); if (!op) fail("操作未在应用包中声明。");
        if (op.effect === "mutation" && !this.options.detail.manifest.automation.capabilities.includes("browser.write")) fail("当前功能未声明网页变更能力。");
        const input = args[1] === undefined ? {} : args[1] as Record<string, unknown>;
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["key", "value"].includes(k))) fail("网页操作参数无效。");
        if (op.row && (typeof input.key !== "string" || !input.key || input.key.length > 1000)) fail("需要明确的记录匹配值。");
        if (["fill", "select"].includes(op.kind) && (typeof input.value !== "string" || input.value.length > 4000)) fail("填写值必须为不超过 4000 字的文本。");
        if (op.kind === "check" && typeof input.value !== "boolean") fail("勾选值必须为布尔值。");
        if (op.effect === "mutation" && !await this.hasGrant(site, op)) {
          if (!this.binding.account) fail("没有可核对的账号标记，不能保存持续网页变更授权。");
          await this.command("release", site);
          const approval: AppBrowserApproval = { id: randomUUID(), siteId: site.id, siteLabel: site.label, origin: this.binding.origin, version: this.options.detail.manifest.version, digest: this.digest, environment: this.binding.environment, account: this.binding.account, requestedOperation: op.id, operations: site.operations.filter(o => o.effect === "mutation"), ...(op.row ? { target: String(input.key) } : {}), ...(input.value !== undefined ? { value: appJsonValue(input.value) } : {}) };
          const wait = new Promise<void>((resolve, reject) => { this.approval = { value: approval, resolve, reject }; }); void wait.catch(() => {});
          await this.options.showApproval(approval); await wait; this.check();
        }
        const result = await this.command("operation", site, { operationId: op.id, input }, op) as Record<string, unknown>;
        if (result?.error) fail(String(result.error));
        if (op.effect === "mutation" && result?.verified !== true) { await this.interrupt("变更已派发，但未确认预期页面状态；运行已中断，请人工核对，不自动重试。"); fail("网页变更结果未知。"); }
        try { await this.options.audit(op.effect === "mutation" ? "网页变更的页面状态已校验" : "网页查询动作已派发，结果需另行读取", { operationId: op.id, effect: op.effect, result }); }
        catch (e) { if(op.effect === "mutation") await this.interrupt("网页变更的校验结果未能保存；运行已中断，请人工核对，不会重复提交。"); throw e; }
        return result;
      }
      if (method === "navigate") { if (typeof args[0] !== "string" || !appSiteAllows(site, args[0])) fail("目标 URL 超出网站声明范围。"); return this.command("navigate", site, { url: args[0] }); }
      if (method === "locate") return (await this.command("locate", site, { locator: parseAppLocator(args[0]) }) as { value: unknown }).value;
      if (method === "read") { const input = { field: parseAppPageField(args[0]) }; return this.captureRead("read",site,input,(await this.command("read",site,input) as {value:unknown}).value); }
      if (method === "extract") {
        const raw = args[0] as { rows?: unknown; fields?: unknown; limit?: unknown };
        if (!raw || !raw.fields || typeof raw.fields !== "object" || Array.isArray(raw.fields) || Object.keys(raw.fields).length > 64) fail("表格字段声明无效。");
        const fields = Object.fromEntries(Object.entries(raw.fields).map(([key, value]) => { if (!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key)) fail("输出字段名无效。"); return [key, parseAppPageField(value)]; }));
        const limit = raw.limit ?? 200; if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 500) fail("读取行数限制应为 1～500。");
        const input = { rows:parseAppLocator(raw.rows),fields,limit };
        return this.captureRead("extract",site,input,(await this.command("extract",site,input) as {value:unknown}).value);
      }
      fail("不支持的网页 SDK 方法。");
    }); this.lane = task; return task;
  }
  async approve(approvalId: string, operationIds: unknown) {
    this.check(); const pending = this.approval;
    if (!pending || pending.value.id !== approvalId || pending.busy || !Array.isArray(operationIds) || !operationIds.includes(pending.value.requestedOperation) || operationIds.some(id => !pending.value.operations.some(o => o.id === id))) fail("授权请求已变化或未勾选当前操作。");
    pending.busy = true;
    try {
      const binding = await this.probe(this.site(pending.value.siteId)); if (binding.accountHash !== this.binding?.accountHash || binding.environment !== this.binding.environment) fail("账号或浏览环境已变化，请停止后重新连接，不保存此授权。");
      const release = await lockAppBrowserGrants(this.options.detail.dataDirectory);
      try {
      this.check();
      const old = (await this.grants()).filter(g => !g.revokedAt), now = new Date().toISOString();
      const grants = [...old, ...[...new Set(operationIds as string[])].map(operationId => { const op = pending.value.operations.find(o => o.id === operationId)!; return { id: randomUUID(), digest: this.digest, siteId: binding.siteId, origin: binding.origin, environment: binding.environment, accountHash: binding.accountHash, accountLabel: binding.account!, operationId, scopeHash: hash(op), approvedAt: now }; })];
      if (grants.length > 500) fail("网页授权记录过多，请先清理已撤销记录。");
      this.check(); await this.options.store.privateJson(this.grantsFile, { schemaVersion: 1, grants });
      } finally { await release(); }
      this.check(); await this.options.showApproval(null); this.approval = null; pending.resolve();
    } catch (e) { pending.busy = false; throw e; }
  }
  ownsBridge(id: string) { return this.bridge?.id === id; }
  commandState(id: string) { return this.commands.get(id)?.phase ?? "cancelled"; }
  close(reason = "网页运行已结束。") {
    this.closed = true; for (const c of this.commands.values()) if (c.phase !== "done") c.phase = "cancelled";
    this.approval?.reject(new Error(reason)); this.approval = null;
    for (const [token, ticket] of globalWeb.tickets) if (ticket.service === this) globalWeb.tickets.delete(token);
    globalWeb.services.delete(this.options.runId);
  }
}
export function appWebServices(ownerKey: string, appId: string) { return [...globalWeb.services.values()].filter(s => s.options.ownerKey === ownerKey && s.options.detail.install.id === appId); }
export function appWebService(owner: string, appId: string, runId: string) { const value = globalWeb.services.get(runId); if (!value || value.options.ownerKey !== owner || value.options.detail.install.id !== appId) fail("网页运行已结束或不属于当前应用。"); return value; }
/** Native final gate: exact payload, one use, current grant, current live run. */
export async function consumeAppBrowserTicket(token: string, payload: string) {
  const ticket = globalWeb.tickets.get(token); globalWeb.tickets.delete(token);
  if (!ticket || ticket.expiresAt < Date.now() || ticket.payload !== payload || ticket.command.phase !== "armed" || ticket.command.lease!==ticket.lease || ticket.command.bridgeId!==ticket.bridgeId) fail("网页派发凭证已失效。");
  await ticket.service.policy(ticket.command);
  if(ticket.command.phase!=="armed"||ticket.command.expiresAt<Date.now()||ticket.command.lease!==ticket.lease||ticket.command.bridgeId!==ticket.bridgeId)fail("网页命令已完成或过期，不派发迟到操作。");
  ticket.command.phase = "dispatched"; ticket.command.dispatched = true;
}
export async function lockAppBrowserGrants(directory: string) { return lockfile.lock(join(directory, "browser-grants"), { realpath: false, retries: { retries: 10, minTimeout: 50, maxTimeout: 200 }, stale: 15000 }); }
