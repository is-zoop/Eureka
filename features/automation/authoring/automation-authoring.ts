import { randomUUID,createHash } from "node:crypto";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { automationAccess } from "../runtime/automation-access";
import { readAutomationTask,assertAutomationTaskIdentity,taskDirectory } from "../runtime/automation-mode-store";
import type { AutomationTaskRef } from "../shared/automation-mode";
import { AutomationAppStore } from "../runtime/automation-app-store";
import { inspectAutomationFiles,parseAutomationAppArchive,AutomationAppError } from "../runtime/automation-app-package";
import { withAutomationAppVersion, withAutomationAppName } from "../runtime/automation-app-metadata";
import { appJsonValue,appRunActive,type AppRunRecord } from "../runtime/automation-app-run";
import { ApplicationBrowserRuntime,lockAppBrowserGrants } from "../runtime/automation-app-browser-runtime";
import { parseAppBrowser,type AppBrowserSite } from "../runtime/automation-app-browser";
import { startAppRun,stopAppRun,getAppRun,readAppConfiguration } from "../runtime/automation-app-runtime";
import { assertAppIdle } from "../runtime/automation-app-lease";
import { AppFileOperations,AutomationAppFiles } from "../runtime/automation-app-files";
import { automationModeFromSession } from "../runtime/automation-session-mode";
import type { AutomationAppDetail } from "../shared/automation-app";
import { appActionDetail, appActions } from "../runtime/automation-app-actions";
import { activateAuthorAction,rememberAuthorAction,type AuthorCheck,type AuthorState } from "./automation-authoring-types";
import { parseAuthorChecks } from "./automation-authoring-validation";
import { editAuthorPackage, type AuthorWriteOptions } from "./automation-authoring-edit";
import { authorValuePage, AUTHOR_MODEL_VALUE_BYTES, type AuthorValuePage } from "./automation-authoring-output";
import { APP_EXECUTION_VALUE_MAX_BYTES } from "../shared/automation-data-limits";
import { localAutomationContext, assertLocalAutomationNamespace, localAutomationTaskOwner } from "../runtime/automation-local-context";
import { LocalAutomationAppStore } from "../runtime/automation-local-store";
import { AutomationSourceReader, mergeSourcePaths, type SourceReadInput } from "./automation-authoring-source";
import { compareAppVersions, latestAppVersion, nextAppVersion } from "../runtime/automation-app-version";
const globals=globalThis as typeof globalThis & {__eurekaAuthors?:Map<string,{generation:number;blockedAt?:string;browser?:ApplicationBrowserRuntime;login?:{resolve:()=>void;reject:(e:Error)=>void}}>};
const actors=globals.__eurekaAuthors??=new Map();
function fail(s:string):never{throw new AutomationAppError(s,409);}
export async function authorAccess(task:AutomationTaskRef,allowClosed=false) {
  assertAutomationTaskIdentity(task);const doc=await readAutomationTask(task);if(!doc)fail("创建任务不存在。");task=doc.task;if(!allowClosed&&doc.status!=="active")fail("创建任务已暂停，请在原对话显式继续。");
  const key=task.ownerKey+":"+task.id;let actor=actors.get(key);if(!actor){actor={generation:0};actors.set(key,actor);}const generation=actor.generation;
  if(!allowClosed&&actor.blockedAt===doc.updatedAt)fail("本轮创建已停止，请由用户在原对话明确继续，不能自动重试。");
  const check=()=>{assertAutomationTaskIdentity(task);if(actor!.generation!==generation)fail("创建操作已取消，不接管过期队列。");};
  const host=new LocalAutomationAppStore(getAgentDir(),task.ownerKey,check),directory=taskDirectory(task);await host.ensureDataDirectory(directory);
  return {task:doc.task,doc,actor,ownerKey:task.ownerKey,runtimeId:task.runtimeId,taskId:task.id,assertIdentity:check,host,directory,store:new AutomationAppStore(join(directory,"runtime"),task.ownerKey,check,{compactWorkspace:true})};
}
type Access=Awaited<ReturnType<typeof authorAccess>>;
export async function authorSource(task: AutomationTaskRef, input: SourceReadInput, signal?: AbortSignal) {
  const a = await authorAccess(task);
  const sourcePaths = mergeSourcePaths(a.doc.sourcePaths ?? [], a.doc.goal);
  return new AutomationSourceReader({ roots: sourcePaths, privateRoots: [getAgentDir()], check: () => { signal?.throwIfAborted(); a.assertIdentity(); } }).read(input);
}
export async function readAuthor(a:Access):Promise<AuthorState>{
  let s:AuthorState;
  try{s=JSON.parse((await a.host.privateBytes(join(a.directory,"author.json"),4*1024*1024)).toString("utf8"));}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {schemaVersion:1,evidence:[]};throw e;}
  if(s?.schemaVersion!==1||!Array.isArray(s.evidence)||s.evidence.length>150)fail("创建记录损坏，未恢复任何执行；请检查该任务数据。");
  const pending=s.pendingWrite;
  if(pending){
    const current=await a.store.find(a.task.baseApp?.id??a.task.id);
    // Only a committed registry revision can complete an interrupted write.
    if(current&&pending.candidate.id===current.id&&current.revision>pending.candidate.revision&&current.activeVersion===pending.version&&current.versions.some(v=>v.version===pending.version&&v.digest===pending.candidate.digest)){
      s.candidate={...pending.candidate,revision:current.revision};delete s.pendingWrite;
    }
  }
  const candidate=s.candidate,intent=candidate?.saveIntent;
  if(candidate&&!candidate.saved&&intent?.digest===candidate.digest){
    const installed=await a.host.find(candidate.id),publishedDigest=intent.publishedDigest??intent.digest;
    if(installed&&installed.revision>intent.revision&&installed.activeVersion&&installed.versions.some(v=>v.version===installed.activeVersion&&v.digest===publishedDigest)){
      s.publication={appId:installed.id,revision:installed.revision,version:installed.activeVersion,digest:publishedDigest};
      s.displayName=intent.displayName??installed.displayName;
      candidate.saved={id:installed.id,version:installed.activeVersion,at:new Date().toISOString(),displayName:s.displayName};
    }
  }
  return s;
}
function checkAuthorState(s:AuthorState){if(s.candidate)rememberAuthorAction(s.candidate);if(s.pendingWrite)rememberAuthorAction(s.pendingWrite.candidate);if(s.evidence.length>150)fail("本次探索证据已达 150 条；已保留原记录，请缩小任务。");appJsonValue(s,4*1024*1024);}
async function write(a:Access,s:AuthorState){a.assertIdentity();checkAuthorState(s);await a.host.privateJson(join(a.directory,"author.json"),s);}
async function locked<T>(a:Access,work:(s:AuthorState)=>Promise<T>){const release=await lockfile.lock(join(a.directory,"author"),{realpath:false,retries:{retries:20,minTimeout:30,maxTimeout:100}});try{a.assertIdentity();return await work(await readAuthor(a));}finally{await release();}}
async function patch(a:Access,work:(s:AuthorState)=>void){return locked(a,async s=>{work(s);await write(a,s);});}
export async function authorFromSession(sessionId:string,allowClosed=true) {
  const auth=await automationAccess(),mode=await automationModeFromSession(sessionId);
  if(!mode||mode.sessionId!==sessionId) return null;
  assertLocalAutomationNamespace(mode.task.ownerKey);auth.assertIdentity();
  return authorAccess(mode.task,allowClosed);
}
/** Used by the EXISTING runtime/browser routes, keeping the same authorization checks. */
export async function authorRequestAccess(request:Request,taskId:string,expected?:{ownerKey?:unknown;runtimeId?:unknown}) {
  const auth=localAutomationContext(),runtimeId=auth.runtimeId;
  const ownerKey=typeof expected?.ownerKey==="string"?expected.ownerKey:localAutomationTaskOwner(taskId);
  assertLocalAutomationNamespace(ownerKey);
  if(expected&&expected.runtimeId!==runtimeId)fail("本地任务上下文已变化，请刷新。");
  return authorAccess({id:taskId,ownerKey,runtimeId},new URL(request.url).searchParams.get("mode")==="spec");
}
export async function authorBrowserSpec(a:Access,appId:string,runId:string,siteId:string){const state=await readAuthor(a),explorer=state.explorer;if(explorer&&explorer.detail.install.id===appId&&explorer.run.id===runId){const native=explorer.run.browserSessions?.find(s=>s.siteId===siteId)?.native;if(native)return native;}const record=await getAppRun(a,appId,runId);const native=record.browserSessions?.find(s=>s.siteId===siteId)?.native;if(!native||native.applicationTaskId!==a.taskId)fail("任务网页引用无效。");return native;}
export async function stopAuthor(task:AutomationTaskRef){const before=await readAutomationTask(task),key=task.ownerKey+":"+task.id,actor=actors.get(key);if(actor){actor.blockedAt=before?.updatedAt;actor.generation++;actor.browser?.close("创建任务已停止。");actor.browser=undefined;actor.login?.reject(new Error("创建已停止。"));actor.login=undefined;}const a=await authorAccess(task,true),state=await readAuthor(a);if(state.candidate?.runId)await stopAppRun(a,state.candidate.id,state.candidate.runId).catch(()=>{});await patch(a,s=>{if(s.explorer&&appRunActive(s.explorer.run.status)){s.explorer.run.status="cancelled";delete s.explorer.run.question;delete s.explorer.run.browserApproval;}});}
export async function revokeAuthorGrant(a:Access,appId:string,grantId:string){await stopAuthor(a.task);const fresh=await authorAccess(a.task,true),s=await readAuthor(fresh),explorer=s.explorer?.detail.install.id===appId?s.explorer:null,store=explorer?fresh.host:fresh.store,directory=explorer?explorer.detail.dataDirectory:store.dataDirectory(appId),release=await lockAppBrowserGrants(directory);try{const file=join(directory,"browser-grants.json"),raw=JSON.parse((await store.privateBytes(file,512000)).toString("utf8"));if(!Array.isArray(raw.grants)||!raw.grants.some((g:{id:string})=>g.id===grantId))fail("授权记录不存在。");raw.grants=raw.grants.map((g:{id:string})=>g.id===grantId?{...g,revokedAt:new Date().toISOString()}:g);await store.privateJson(file,raw);}finally{await release();}}
export async function releaseAuthorBrowser(task:AutomationTaskRef){const a=await authorAccess(task,true);a.actor.browser?.close();a.actor.browser=undefined;a.actor.login?.reject(new Error("网页已释放。"));a.actor.login=undefined;await patch(a,s=>{if(s.explorer&&["running","waiting-user","waiting-browser"].includes(s.explorer.run.status)){s.explorer.run.status="completed";s.explorer.run.finishedAt=new Date().toISOString();delete s.explorer.run.browserApproval;delete s.explorer.run.question;}});}
export async function authorExplore(task:AutomationTaskRef,method:string,args:unknown[],signal?:AbortSignal) {
  const a=await authorAccess(task);const abort=()=>{a.actor.browser?.close("创建步骤已取消。");a.actor.browser=undefined;a.actor.login?.reject(new Error("创建步骤已取消。"));a.actor.login=undefined;};signal?.throwIfAborted();signal?.addEventListener("abort",abort,{once:true});
  try {
    if(method==="open") {
      const state=await readAuthor(a);
      if(state.candidate?.runId&&appRunActive((await getAppRun(a,state.candidate.id,state.candidate.runId)).status))fail("候选应用正在试运行，请等待或停止原运行，再打开探索；不会抢占正在运行的网页。");
      await releaseAuthorBrowser(task);
      const raw=args[0] as AppBrowserSite,site=parseAppBrowser({schemaVersion:1,sites:[raw]},["browser.read","browser.write"]).sites[0];
      if(site.operations.some(operation=>operation.effect==="mutation"))fail("创建仅支持只读网页探索；业务变更请在应用界面人工运行。");
      const id=randomUUID(),runId=randomUUID(),version="0.0.1",digest=createHash("sha256").update(JSON.stringify(site)).digest("hex");
      const detail:AutomationAppDetail={install:{id,name:"creation-explorer",displayName:"网页探索",activeVersion:version,disabled:false,revision:1,installedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),versions:[{version,digest,installedAt:new Date().toISOString()}]},manifest:{name:"creation-explorer",version,displayName:"网页探索",description:"本次创建的临时浏览器适配器",automation:{id,schemaVersion:1,runtime:"javascript-esm",entry:"scripts/main.mjs",ui:"ui.json",workflow:"workflow.json",files:[],capabilities:["browser.read","browser.write"],browser:{schemaVersion:1,sites:[site]}}},ui:{schemaVersion:1,fields:[],buttons:[],results:{columns:[]}},workflow:{schemaVersion:1,nodes:[],edges:[]},files:[],readme:"",codeDirectory:"",dataDirectory:join(a.directory,"explorer")};
      await a.host.ensureDataDirectory(detail.dataDirectory);
      const run:AppRunRecord={schemaVersion:1,id:runId,appId:id,version,digest,runtimeId:a.runtimeId,serverId:"creation",serverPid:process.pid,actionId:"explore",status:"running",startedAt:new Date().toISOString(),workflow:detail.workflow,events:[],artifacts:[],resultColumns:[]};
      await patch(a,s=>{s.explorer={run,detail};});
      const service=new ApplicationBrowserRuntime({taskId:task.id,ownerKey:a.ownerKey,runtimeId:a.runtimeId,runId,detail,store:a.host,check:()=>{a.assertIdentity();signal?.throwIfAborted();},
        connection:waiting=>patch(a,s=>{if(s.explorer?.run.id===runId&&(waiting&&s.explorer.run.status==="running"||!waiting&&s.explorer.run.status==="waiting-browser"))s.explorer.run.status=waiting?"waiting-browser":"running";}),
        askLogin:message=>new Promise<void>((resolve,reject)=>{a.actor.login={resolve,reject};void patch(a,s=>{if(s.explorer?.run.id===runId){s.explorer.run.status="waiting-user";s.explorer.run.question={id:randomUUID(),questions:[{id:randomUUID(),toolCallId:runId,title:"登录或人工验证",question:message,options:[{id:"1",label:"已完成，继续",description:"重新读取当前账号"}],selection:"single",status:"pending",askedAt:new Date().toISOString()}]};}}).catch(reject);}),
        showApproval:async approval=>{await patch(a,s=>{if(s.explorer?.run.id===runId){s.explorer.run.status=approval?"waiting-user":"running";if(approval)s.explorer.run.browserApproval=approval;else delete s.explorer.run.browserApproval;}});},
        saveSession:session=>patch(a,s=>{if(s.explorer?.run.id===runId)s.explorer.run.browserSessions=[session];}),
        audit:async(message)=>{await patch(a,s=>{if(s.explorer?.run.id===runId)s.explorer.run.events.push({seq:s.explorer.run.events.length+1,runId,at:new Date().toISOString(),kind:"log",status:"browser",message});});},
        unknownOutcome:async reason=>{if(a.actor.browser?.options.runId===runId)a.actor.browser=undefined;await patch(a,s=>{if(s.explorer?.run.id===runId){s.explorer.run.status="interrupted";s.explorer.run.error=reason;delete s.explorer.run.browserApproval;delete s.explorer.run.question;}});}
      });a.actor.browser=service;
      try {const value=await service.call("connect",[site.id]),evidenceId=randomUUID();await patch(a,s=>{s.evidence.push({id:evidenceId,method:"connect",at:new Date().toISOString(),value:appJsonValue(value)});});return {connected:true,evidenceId,value};}
      catch(error){service.close();if(a.actor.browser===service){a.actor.browser=undefined;a.actor.login?.reject(new Error("探索连接已结束。"));a.actor.login=undefined;}await patch(a,s=>{if(s.explorer?.run.id===runId&&["running","waiting-user","waiting-browser"].includes(s.explorer.run.status)){s.explorer.run.status="failed";s.explorer.run.finishedAt=new Date().toISOString();s.explorer.run.error=error instanceof Error?error.message:"探索连接失败";delete s.explorer.run.question;delete s.explorer.run.browserApproval;}}).catch(()=>{});throw error;}
    }
    const service=a.actor.browser;if(!service)fail("请先打开本次探索网站；恢复只会重新观察，不重复动作。");
    const sites=service.options.detail.manifest.automation.browser?.sites as AppBrowserSite[]|undefined;
    const operation=sites?.[0]?.operations.find(op=>op.id===args[0]);
    if(["operation","request"].includes(method)&&operation?.effect==="mutation")fail("业务变更仅由用户人工运行。");
    const result=await service.call(method,args);signal?.throwIfAborted();
    return rememberAuthorValue(a,method,result);
  } finally {signal?.removeEventListener("abort",abort);}
}
export async function authorPackage(a:Access,source:"current"|"base"="current") {
  const state=await readAuthor(a);
  if(source==="current"&&state.candidate)return parseAutomationAppArchive((await a.store.export(state.candidate.id)).bytes);
  if(state.publication){
    const saved=state.publication,pkg=parseAutomationAppArchive((await a.host.export(saved.appId,saved.version)).bytes);
    if(pkg.digest!==saved.digest)fail("已保存版本的代码与本会话记录不一致，请刷新后重试。");
    return pkg;
  }
  if(!a.task.baseApp)return undefined;
  const current=await a.host.find(a.task.baseApp.id);
  if(current?.revision!==a.task.baseApp.revision||!current.versions.some(item=>item.version===a.task.baseApp!.version))fail("原应用已变化，请使用当前草稿或重新打开修改。");
  return parseAutomationAppArchive((await a.host.export(a.task.baseApp.id,a.task.baseApp.version)).bytes);
}
/** Server-owned continuation for legacy conversations that exited on Save. */
export async function authorSavedReference(task:AutomationTaskRef){
  const a=await authorAccess(task,true),state=await readAuthor(a),saved=state.candidate?.saved;
  if(!saved)return null;
  const app=await a.host.find(saved.id);
  if(!app||app.managedPlugin)return null;
  return {id:app.id,revision:app.revision,version:app.activeVersion,displayName:app.displayName};
}
export async function authorWrite(task:AutomationTaskRef,rawFiles:Record<string,string>|undefined,scope:string[]|undefined,limitations:string[]|undefined,checks:AuthorCheck[]=[],options:AuthorWriteOptions={}) {
  const a=await authorAccess(task);await releaseAuthorBrowser(task);
  return locked(a,async s=>{
    const base=await authorPackage(a);let pkg=editAuthorPackage(base,rawFiles,options);
    const published=await a.host.find(pkg.manifest.automation.id);
    if(published&&pkg.digest!==base?.digest&&compareAppVersions(pkg.manifest.version,latestAppVersion(published.versions))<=0)pkg=withAutomationAppVersion(pkg,nextAppVersion(latestAppVersion(published.versions)));
    if(pkg.manifest.automation.id!==(task.baseApp?.id??task.id))fail("应用 ID 必须使用本任务的 suggestedAppId，不能复用其他任务或应用。");
    const texts=[...pkg.files].filter(([name])=>!/\.(png|jpe?g|webp|gif|ico)$/.test(name)).map(([,bytes])=>bytes.toString("utf8"));
    const samples=a.doc.goal.match(/\d{8,}/g)??[];
    if(texts.some(text=>samples.some(id=>text.includes(id))||/(?:^|[\s"'(=])[A-Za-z]:[\\/][^\s"']+/m.test(text)||/["'](?:password|cookie|authorization|apiKey|access_token)["']\s*:\s*["'][^"']+["']/i.test(text)))fail("发布代码含本次实际编号、绝对路径或凭证字面量，请改为参数；实际测试数据仅放私有配置。");
    scope??=s.candidate?.scope??[pkg.manifest.description];limitations??=s.candidate?.limitations??[];
    if(!Array.isArray(scope)||!scope.length||scope.length>64||scope.some(v=>typeof v!=="string"||!v.trim()||v.length>1000)||!Array.isArray(limitations)||limitations.length>30||limitations.some(v=>typeof v!=="string"||v.length>1000))fail("需要实际输出范围及限制说明。");
    const identities=s.evidence.filter(e=>e.method==="connect").map(e=>(e.value as {account?:unknown})?.account).filter((v):v is string=>typeof v==="string"&&v.length>=4);
    if(texts.some(text=>identities.some(value=>text.includes(value))))fail("发布包含实际登录账号标记，请改用宿主浏览器引用。");
    if(s.candidate)await assertAppIdle(a.store.dataDirectory(s.candidate.id));
    const selected=appActionDetail(pkg,s.candidate?.digest===pkg.digest?s.candidate.actionId:undefined);
    try{checks=parseAuthorChecks(checks,selected,s.evidence);}catch(error){fail(error instanceof Error?error.message:"校验规则无效。");}
    const current=await a.store.find(pkg.manifest.automation.id),sameCode=s.candidate?.digest===pkg.digest;
    const candidate={id:pkg.manifest.automation.id,digest:pkg.digest,revision:current?.revision??0,scope,limitations,checks,actionId:selected.actionId,...(pkg.actions?{actionTrials:sameCode?s.candidate?.actionTrials??{}:{}}:{}),...(sameCode&&s.candidate?.runId?{runId:s.candidate.runId}:{}),...(sameCode&&s.candidate?.saved?{saved:s.candidate.saved}:{})};
    const next={...s,candidate};delete next.pendingWrite;checkAuthorState(next);
    s.pendingWrite={version:pkg.manifest.version,candidate};await write(a,s);
    const install=await a.store.install(pkg,current?.revision??0,undefined,true);
    s.candidate={...candidate,revision:install.revision};delete s.pendingWrite;
    try{await write(a,s);}catch(error){a.assertIdentity();fail(`代码包已生成，但创建状态保存失败。请先调用 eureka_automation_task 恢复当前草稿，不要重写代码。原因：${error instanceof Error?error.message:"状态写入失败"}`);}
    return {generated:true,saved:Boolean(candidate.saved),appId:install.id,version:pkg.manifest.version,digest:pkg.digest,revision:install.revision,changedFiles:[...pkg.files].filter(([name,bytes])=>!base?.files.get(name)?.equals(bytes)).map(([name])=>name),deletedFiles:base?[...base.files.keys()].filter(name=>!pkg.files.has(name)):[],actions:appActions(pkg).map(action=>({id:action.id,label:action.label})),testing:"manual-only"};
  });
}
/** Explicit user-run from the preview. Rules are optional; runtime approvals still apply. */
export async function authorManualTest(task:AutomationTaskRef,appId:string,revision:number,runId:string,values:unknown,configRevision:number,actionId:string){
  const a=await authorAccess(task);
  await releaseAuthorBrowser(task);
  return locked(a,async s=>{
    const c=s.candidate;if(!c||c.saved||c.id!==appId||c.revision!==revision)fail("待运行代码已变化，请刷新当前应用。");
    const detail=appActionDetail(await a.store.detail(appId),actionId);
    const version=detail.install.versions.find(v=>v.version===detail.manifest.version);
    if(version?.digest!==c.digest)fail("草稿代码已变化，请刷新后重试。");
    // Let the runtime verify the original input hash on a repeated HTTP request.
    // A retry of an older run must never replace the current action/trial.
    let existing:AppRunRecord|undefined;
    try{existing=await getAppRun(a,appId,runId);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    if(existing){
      if(existing.digest!==c.digest||existing.actionId!==actionId)fail("运行引用与当前代码或功能不一致。");
      return startAppRun(a,appId,revision,runId,values,configRevision,actionId);
    }
    if(c.runId&&appRunActive((await getAppRun(a,appId,c.runId)).status))fail("另一试运行尚未结束，请等待或停止后再运行。");
    const previous=structuredClone(c);
    if(c.actionTrials)activateAuthorAction(c,detail.actionId);else c.actionId=detail.actionId;
    c.runId=runId;delete c.validation;delete c.lastError;await write(a,s);
    try{return await startAppRun(a,appId,revision,runId,values,configRevision,actionId);}
    catch(error){
      try{await getAppRun(a,appId,runId);}catch(readError){if((readError as NodeJS.ErrnoException).code==="ENOENT")s.candidate=previous;}
      await write(a,s);throw error;
    }
  });
}
export async function saveAuthor(task:AutomationTaskRef,digest:string,displayName?:unknown){const a=await authorAccess(task);return locked(a,async s=>{const c=s.candidate;if(!c||c.digest!==digest)fail("待保存代码已变化，请重新查看。");if(c.saved)return c.saved;
  await assertAppIdle(a.store.dataDirectory(c.id));const exported=await a.store.export(c.id),source=inspectAutomationFiles((await import("../runtime/automation-app-package")).parseAutomationAppArchive(exported.bytes).files);
  if(source.digest!==digest)fail("待保存包与当前草稿代码不一致。");
  const old=await a.host.find(c.id);if(c.saveIntent?.digest===digest&&old?.activeVersion===source.manifest.version&&old.versions.some(v=>v.version===source.manifest.version&&v.digest===(c.saveIntent!.publishedDigest??digest))){s.publication={appId:old.id,revision:old.revision,version:old.activeVersion,digest:c.saveIntent.publishedDigest??digest};s.displayName=c.saveIntent.displayName??source.manifest.displayName;c.saved={id:old.id,version:old.activeVersion,at:new Date().toISOString(),displayName:c.saveIntent.displayName??source.manifest.displayName};await write(a,s);return c.saved;}
  const expected=s.publication??(task.baseApp?{appId:task.baseApp.id,revision:task.baseApp.revision,version:task.baseApp.version}:undefined);
  if(expected?(old?.id!==expected.appId||old.revision!==expected.revision||!old.versions.some(item=>item.version===expected.version)):Boolean(old))fail("应用登记已变化，请重新从目录创建修改任务。");
  let pkg=withAutomationAppName(source,displayName===undefined?s.displayName:displayName);
  if(old&&compareAppVersions(pkg.manifest.version,latestAppVersion(old.versions))<=0)pkg=withAutomationAppVersion(pkg,nextAppVersion(latestAppVersion(old.versions)));
  c.saveIntent={digest,revision:old?.revision??0,publishedDigest:pkg.digest,displayName:pkg.manifest.displayName};await write(a,s);const install=await a.host.install(pkg,c.saveIntent.revision);s.publication={appId:install.id,revision:install.revision,version:install.activeVersion,digest:pkg.digest};s.displayName=pkg.manifest.displayName;c.saved={id:install.id,version:install.activeVersion,at:new Date().toISOString(),displayName:pkg.manifest.displayName};await write(a,s);return c.saved;});}
/** Explicit metadata refresh; never starts a run or changes executable evidence. */
export async function refreshAuthor(task:AutomationTaskRef){
  const a=await authorAccess(task,true);
  await locked(a,async state=>{
    const candidate=state.candidate;if(!candidate||candidate.saved)return;
    const detail=await a.store.detail(candidate.id);
    const current=detail.install.versions.find(version=>version.version===detail.manifest.version);
    if(current?.digest!==candidate.digest)fail("草稿代码已变化，请在原对话重新读取当前应用后继续；刷新不会覆盖代码或沿用过期校验。");
    candidate.revision=detail.install.revision;
    if(candidate.lastError==="应用已变化，请刷新后重试")delete candidate.lastError;
    await write(a,state);
  });
  return authorSnapshot(a);
}
export async function recoverAuthor(a:Access){
  await locked(a,async state=>{
    // Older hosts installed code before persisting a candidate, with no intent.
    // Recover only this task's private package, never a published application or
    // an active/previous trial. Recovery never marks the code as validated.
    if(!state.pendingWrite&&!state.candidate?.saved&&!state.candidate?.runId){
      const current=await a.store.find(a.task.baseApp?.id??a.task.id);
      const version=current?.versions.find(v=>v.version===current.activeVersion);
      if(current&&version&&state.candidate?.digest!==version.digest){
        const detail=await a.store.detail(current.id),actions=appActions(detail);
        state.candidate={id:current.id,digest:version.digest,revision:current.revision,scope:actions.map(action=>action.label),limitations:["已恢复入库后未完成状态保存的草稿；尚未试运行或校验。"],checks:[],actionId:appActionDetail(detail).actionId,...(detail.manifest.automation.actions?{actionTrials:{}}:{})};
      }
    }
    await write(a,state);
  });
}
export async function authorSnapshot(a:Access,recover=false){
  if(recover)await recoverAuthor(a);
  let state=await readAuthor(a);
  if(state.explorer&&appRunActive(state.explorer.run.status)&&state.explorer.run.serverPid!==process.pid&&!a.actor.browser){await patch(a,s=>{if(s.explorer&&appRunActive(s.explorer.run.status)&&s.explorer.run.serverPid!==process.pid){s.explorer.run.status="interrupted";s.explorer.run.finishedAt=new Date().toISOString();s.explorer.run.error="开发服务或执行进程已重启，原网页探索已中断；刷新不会重新执行旧操作。";delete s.explorer.run.question;delete s.explorer.run.browserApproval;}});state=await readAuthor(a);}
  const c=state.candidate;return {task:a.task,sessionId:a.doc.sessionId,active:a.doc.status==="active"&&a.actor.blockedAt!==a.doc.updatedAt,goal:a.doc.goal,state,ownerKey:a.ownerKey,runtimeId:a.runtimeId,...(c?{detail:appActionDetail(await a.store.detail(c.id),c.actionId),...(c.runId?{run:await getAppRun(a,c.id,c.runId)}:{})}:{})};
}
export async function authorFile(task:AutomationTaskRef,fieldId:string,method:string,relative?:string,actionId?:string){const a=await authorAccess(task);if(!["list","readText","readJson"].includes(method))fail("仅开放已选文件的读取探索。");const s=await readAuthor(a),c=s.candidate;if(!c)fail("先生成带文件配置项的草稿，由用户选择业务文件。");const detail=appActionDetail(await a.store.detail(c.id),actionId??c.actionId),config=await readAppConfiguration(a,c.id,detail.actionId),grants=await new AutomationAppFiles(a.store,detail).validateReferences(config.values,c.digest),ref=config.values[fieldId];if(!ref||typeof ref!=="object"||Array.isArray(ref))fail("请在对话中的配置卡片选择并保存该文件。");const value=await new AppFileOperations(a.store.workspaceDirectory(c.id),grants,detail.manifest.automation.capabilities,a.assertIdentity).call(method,[{...ref,...(relative?{relative}:{})}]);return rememberAuthorValue(a,"file."+method,value);}


async function rememberAuthorValue(a:Access,method:string,raw:unknown){
  const value=appJsonValue(raw,APP_EXECUTION_VALUE_MAX_BYTES),evidenceId=randomUUID();
  const fingerprint=createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const previous=(await readAuthor(a)).evidence.find(e=>!e.runId&&e.fingerprint===fingerprint);
  if(previous)return {evidenceId:previous.id,unchanged:true,message:"内容与已有只读探索相同；未重复返回正文，可按 evidenceId 读取必要字段。"};
  const large=Buffer.byteLength(JSON.stringify(value))>AUTHOR_MODEL_VALUE_BYTES;
  if(large)await a.host.privateJson(join(a.directory,"exploration-values",evidenceId+".json"),value);
  await patch(a,s=>{
    if(s.evidence.length>=150)fail("本次探索记录已达 150 条，请缩小任务。");
    s.evidence.push({id:evidenceId,method,at:new Date().toISOString(),fingerprint,value:large?{stored:true}:value,...(large?{valueRef:evidenceId}:{})});
  });
  return {evidenceId,...authorValuePage(value,evidenceId)};
}
export async function authorEvidence(task:AutomationTaskRef,id:string,options:AuthorValuePage={}){
  const a=await authorAccess(task),s=await readAuthor(a);
  const entry=s.evidence.find(e=>e.id===id&&!e.runId&&!e.id.startsWith("run:"));
  if(!entry)fail("仅能读取本任务的只读探索记录；人工试运行结果不向模型开放。");
  let value:unknown=entry.value;
  if(entry.valueRef){
    if(entry.valueRef!==entry.id||!/^[a-f0-9-]{36}$/.test(entry.valueRef))fail("探索记录引用无效。");
    value=JSON.parse((await a.host.privateBytes(join(a.directory,"exploration-values",entry.valueRef+".json"),APP_EXECUTION_VALUE_MAX_BYTES+1)).toString("utf8"));
  }
  return {evidenceId:id,...authorValuePage(value,id,options)};
}
