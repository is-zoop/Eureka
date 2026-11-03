import { randomUUID,createHash } from "node:crypto";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir,SessionManager } from "@earendil-works/pi-coding-agent";
import { automationAccess } from "./automation-access";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { readAutomationTask,assertAutomationTaskIdentity,taskDirectory } from "./automation-mode-store";
import { readAutomationMode,type AutomationTaskRef } from "./automation-mode";
import { AutomationAppStore } from "./automation-app-store";
import { inspectAutomationFiles,AutomationAppError } from "./automation-app-package";
import { withAutomationAppName } from "./automation-app-metadata";
import { appJsonValue,appRunActive,type AppRunRecord } from "./automation-app-run";
import { ApplicationBrowserRuntime,lockAppBrowserGrants } from "./automation-app-browser-runtime";
import { parseAppBrowser,type AppBrowserSite } from "./automation-app-browser";
import { startAppRun,stopAppRun,getAppRun,readAppConfiguration,appRunValue,appRunArtifact } from "./automation-app-runtime";
import { assertAppIdle } from "./automation-app-lease";
import { AppFileOperations,AutomationAppFiles } from "./automation-app-files";
import { resolveSessionPath } from "./session-reader";
import type { AutomationAppDetail } from "./automation-app";
import { authorEqual,authorValueAt,type AuthorCheck,type AuthorState,type AuthorFinding } from "./automation-authoring-types";
import { authorCheckPlan,authorColumnCoverage,parseAuthorChecks,replaceAuthorChecks } from "./automation-authoring-validation";
const globals=globalThis as typeof globalThis & {__eurekaAuthors?:Map<string,{generation:number;blockedAt?:string;browser?:ApplicationBrowserRuntime;login?:{resolve:()=>void;reject:(e:Error)=>void}}>};
const actors=globals.__eurekaAuthors??=new Map();
function fail(s:string):never{throw new AutomationAppError(s,409);}
export async function authorAccess(task:AutomationTaskRef,allowClosed=false) {
  assertAutomationTaskIdentity(task);const doc=await readAutomationTask(task);if(!doc)fail("创建任务不存在。");if(!allowClosed&&doc.status!=="active")fail("创建任务已暂停，请在原对话显式继续。");
  const key=task.ownerKey+":"+task.id;let actor=actors.get(key);if(!actor){actor={generation:0};actors.set(key,actor);}const generation=actor.generation;
  if(!allowClosed&&actor.blockedAt===doc.updatedAt)fail("本轮创建已停止，请由用户在原对话明确继续，不能自动重试。");
  const check=()=>{assertAutomationTaskIdentity(task);if(actor!.generation!==generation)fail("创建操作已取消，不接管过期队列。");};
  const host=new AutomationAppStore(getAgentDir(),task.ownerKey,check),directory=taskDirectory(task);await host.ensureDataDirectory(directory);
  return {task:doc.task,doc,actor,ownerKey:task.ownerKey,runtimeId:task.runtimeId,taskId:task.id,assertIdentity:check,host,directory,store:new AutomationAppStore(join(directory,"runtime"),task.ownerKey,check,{compactWorkspace:true})};
}
type Access=Awaited<ReturnType<typeof authorAccess>>;
export async function readAuthor(a:Access):Promise<AuthorState>{try{const raw=JSON.parse((await a.host.privateBytes(join(a.directory,"author.json"),4*1024*1024)).toString("utf8"));if(raw?.schemaVersion!==1||!Array.isArray(raw.evidence)||raw.evidence.length>150)fail("创建记录损坏，未恢复任何执行；请检查该任务数据。");return raw;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {schemaVersion:1,evidence:[]};throw e;}}
async function write(a:Access,s:AuthorState){a.assertIdentity();if(s.evidence.length>150)fail("本次探索证据已达 150 条；已保留原记录，请缩小任务。");appJsonValue(s,4*1024*1024);await a.host.privateJson(join(a.directory,"author.json"),s);}
async function locked<T>(a:Access,work:(s:AuthorState)=>Promise<T>){const release=await lockfile.lock(join(a.directory,"author"),{realpath:false,retries:{retries:20,minTimeout:30,maxTimeout:100}});try{a.assertIdentity();return await work(await readAuthor(a));}finally{await release();}}
async function patch(a:Access,work:(s:AuthorState)=>void){return locked(a,async s=>{work(s);await write(a,s);});}
// Only host browser events can become read evidence; script logs and result
// values cannot mint evidence IDs. Old runs with no such events stay unverified.
async function collectRunEvidence(a:Access,s:AuthorState,run:AppRunRecord) {
  if(appRunActive(run.status)||run.digest!==s.candidate?.digest)return;
  const cursor=s.evidenceCursor?.runId===run.id?s.evidenceCursor.seq:0;
  const events=run.events.filter(event=>event.seq>cursor);
  if(!events.length)return;
  let bytes=Buffer.byteLength(JSON.stringify(s.evidence));
  for(const event of events){
    if(event.kind!=="log"||event.status!=="browser"||event.message!=="已记录网页字段证据"||!event.outputRef)continue;
    const id=`run:${run.id}:${event.seq}`;if(s.evidence.some(entry=>entry.id===id))continue;
    try {
      const record=await appRunValue(a,run.appId,run.id,event.outputRef) as {method?:unknown;value?:unknown;siteId?:unknown;args?:unknown};
      if(!record||!["read","extract"].includes(String(record.method))||record.value===undefined)throw new Error("实际读取记录无效。");
      const entry={id,method:String(record.method),at:event.at,runId:run.id,digest:run.digest,value:appJsonValue(record.value,256000),context:appJsonValue({siteId:record.siteId??null,args:record.args??null,nodeId:event.nodeId??null,execution:event.execution??null},256000)};
      const size=Buffer.byteLength(JSON.stringify(entry));
      if(s.evidence.length>=150||bytes+size>2*1024*1024){s.evidenceWarnings=["本任务证据保存范围已满，部分网页读取仅保留在实际运行日志中；未自动补齐或标记通过。请缩小读取范围。"];continue;}
      s.evidence.push(entry);bytes+=size;
    }catch{a.assertIdentity();s.evidenceWarnings=["实际运行的部分网页读取记录无法完整导入；原结果已保留，缺少的证据仍需通过真实页面补足。"];}
  }
  if(events.some(event=>event.status==="browser"&&event.message?.startsWith("网页字段证据超过保存范围")))s.evidenceWarnings=[...(s.evidenceWarnings??[]),"实际运行有读取超过单项或次数限制，相关字段须重新取得完整证据。"].slice(0,2);
  s.evidenceCursor={runId:run.id,seq:events.at(-1)!.seq};
}
export async function authorFromSession(sessionId:string,allowClosed=true) {
  const auth=await automationAccess(),file=await resolveSessionPath(sessionId);if(!file)fail("会话不存在。");const manager=SessionManager.open(file),mode=readAutomationMode(manager.getBranch());
  if(!mode||mode.sessionId!==sessionId||mode.task.ownerKey!==auth.ownerKey) return null;
  return authorAccess(mode.task,allowClosed);
}
/** Used by the EXISTING runtime/browser routes, keeping the same authorization checks. */
export async function authorRequestAccess(request:Request,taskId:string,expected?:{ownerKey?:unknown;runtimeId?:unknown}) {
  const auth=await automationAccess(),runtimeId=readRuntimeHazeSession()?.runtimeId;if(!runtimeId)fail("请先登录。");
  if(expected&&(expected.ownerKey!==auth.ownerKey||expected.runtimeId!==runtimeId))fail("登录身份已变化。");
  return authorAccess({id:taskId,ownerKey:auth.ownerKey,runtimeId},new URL(request.url).searchParams.get("mode")==="spec");
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
    const result=await service.call(method,args);signal?.throwIfAborted();
    const evidenceId=randomUUID();await patch(a,s=>{if(s.evidence.length>=150)fail("本次探索证据已达 150 条，请缩小任务。");s.evidence.push({id:evidenceId,method,at:new Date().toISOString(),value:appJsonValue(result,256000)});});return {evidenceId,value:result};
  } finally {signal?.removeEventListener("abort",abort);}
}
export async function authorWrite(task:AutomationTaskRef,rawFiles:Record<string,string>,scope:string[],limitations:string[],checks:AuthorCheck[]) {
  const a=await authorAccess(task);await releaseAuthorBrowser(task);
  if(!rawFiles||typeof rawFiles!=="object"||Array.isArray(rawFiles)||Object.values(rawFiles).some(v=>typeof v!=="string"))fail("代码文件必须是相对路径到文本的对象。");
  const pkg=inspectAutomationFiles(new Map(Object.entries(rawFiles).map(([name,text])=>[name,Buffer.from(text)])));
  if(pkg.manifest.automation.id!==(task.baseApp?.id??task.id))fail("应用 ID 必须使用本任务的 suggestedAppId，不能复用其他任务或应用。");
  const samples=a.doc.goal.match(/\d{8,}/g)??[];for(const text of Object.values(rawFiles))if(samples.some(id=>text.includes(id))||/(?:^|[\s"'(=])[A-Za-z]:[\\/][^\s"']+/m.test(text)||/["'](?:password|cookie|authorization|apiKey|access_token)["']\s*:\s*["'][^"']+["']/i.test(text))fail("发布代码含本次实际编号、绝对路径或凭证字面量，请改为参数；实际测试数据仅放私有 values/checks。");
  if(!Array.isArray(scope)||!scope.length||scope.length>64||scope.some(v=>typeof v!=="string"||!v.trim()||v.length>1000)||!Array.isArray(limitations)||limitations.length>30||limitations.some(v=>typeof v!=="string"||v.length>1000))fail("需要实际输出范围及限制说明。");
  if(task.baseApp&&(pkg.manifest.automation.id!==task.baseApp.id||pkg.manifest.version===task.baseApp.version))fail("修改应用必须保留应用 ID，并使用新的版本号。");
  return locked(a,async s=>{
    const identities=s.evidence.filter(e=>e.method==="connect").map(e=>(e.value as {account?:unknown})?.account).filter((v):v is string=>typeof v==="string"&&v.length>=4);if(Object.values(rawFiles).some(text=>identities.some(value=>text.includes(value))))fail("发布包含实际登录账号标记，请改用宿主浏览器引用。");
    if(s.candidate?.saved)fail("该创建任务已保存，请用 AI 修改入口创建新版本。");
    if(s.candidate?.runId&&appRunActive((await getAppRun(a,s.candidate.id,s.candidate.runId)).status))fail("试运行尚未结束，请先停止。");
    if(s.candidate)await assertAppIdle(a.store.dataDirectory(s.candidate.id));
    try{checks=parseAuthorChecks(checks,pkg,s.evidence);}catch(error){fail(error instanceof Error?error.message:"校验规则无效。");}
    const current=await a.store.find(pkg.manifest.automation.id),install=await a.store.install(pkg,current?.revision??0);
    const sameCode=s.candidate?.digest===pkg.digest?s.candidate.runId:undefined;
    s.candidate={id:install.id,digest:pkg.digest,revision:install.revision,scope,limitations,checks,...(sameCode?{runId:sameCode}:{})};await write(a,s);return {generated:true,saved:false,appId:install.id,version:pkg.manifest.version,digest:pkg.digest,parameters:pkg.ui.fields,scope,limitations,checkPlan:authorCheckPlan(pkg,checks,s.evidence),validation:sameCode?"可用 eureka_app_validate 更新校验规则，对同一次实际运行重新校验，无需再次执行":"尚未试运行"};
  });
}
export async function authorTest(task:AutomationTaskRef,values:unknown,signal?:AbortSignal,actionId?:string,collectEvidence=false){const a=await authorAccess(task);return locked(a,async s=>{const c=s.candidate;if(!c||c.saved)fail("请先生成尚未保存的应用代码。");if(c.runId){const old=await getAppRun(a,c.id,c.runId);if(appRunActive(old.status))return old;const detail=await a.store.detail(c.id);if(detail.manifest.automation.capabilities.some(v=>["browser.write","files.write"].includes(v))&&Date.parse(a.doc.updatedAt)<=Date.parse(old.startedAt))fail("本轮已执行含变更的试运行。请用 waitOnly 查看或直接校验原结果；再次执行须由用户在原对话明确继续。");}
  const detail=await a.store.detail(c.id),plan=authorCheckPlan(detail,c.checks,s.evidence);
  if(!plan.ready&&!collectEvidence)fail(`${plan.blocking.join("；")}。请先用 eureka_app_validate 的 checks 更新规则；确需先取得真实字段时，显式使用 collectEvidence:true，仅采集证据，不能宣称通过。`);
  if(!values||typeof values!=="object"||Array.isArray(values))fail("试运行参数需要对象。");const config=await readAppConfiguration(a,c.id),inputs={...config.values,...values};c.runId=randomUUID();delete c.validation;delete c.lastError;await write(a,s);signal?.throwIfAborted();try{return await startAppRun(a,c.id,c.revision,c.runId,inputs,config.revision,actionId);}catch(e){try{await getAppRun(a,c.id,c.runId);}catch{delete c.runId;}c.lastError=e instanceof Error?e.message:"试运行准备失败";await write(a,s);throw e;}});}
export async function authorValidate(task:AutomationTaskRef,options:{checks?:AuthorCheck[];digest?:string;runId?:string;prepareOnly?:boolean}={}) {
  const a=await authorAccess(task);
  return locked(a,async s=>{
    const c=s.candidate;if(!c||c.saved)fail("请先生成尚未保存的应用代码。");
    const run=c.runId?await getAppRun(a,c.id,c.runId):undefined,detail=await a.store.detail(c.id);
    if(options.checks!==undefined){
      if(options.digest!==c.digest||options.runId!==c.runId)fail("代码或试运行记录已变化，请先读取当前任务，再修改所属校验规则。");
      if(run&&appRunActive(run.status))fail("仍在运行或等待用户，请结束后再修改校验规则。");
    }
    if(run)await collectRunEvidence(a,s,run);
    if(options.checks!==undefined){try{replaceAuthorChecks(c,detail,options.checks,s.evidence,options);}catch(error){fail(error instanceof Error?error.message:"校验规则无效。");}}
    const checkPlan=authorCheckPlan(detail,c.checks,s.evidence);
    if(options.prepareOnly){await write(a,s);return {status:"prepared",runId:c.runId,digest:c.digest,checkPlan,message:"仅检查或更新私有校验规则，未执行应用；现有代码、文件选择和运行结果已保留。"};}
    if(!run)fail("尚未实际试运行；可先使用 prepareOnly:true 完善规则。");
    if(appRunActive(run.status))return {status:run.status,runId:run.id,message:"仍在运行或等待用户，不能标记通过。"};
    if(run.status!=="completed"||run.digest!==c.digest)fail("试运行未完成或代码已变化，不能标记校验通过。");
    const result=run.resultRef?await appRunValue(a,c.id,run.id,run.resultRef):undefined;
    const input=run.events.find(event=>event.kind==="run"&&event.status==="running"&&event.inputRef);if(!input?.inputRef)fail("试运行缺少实际输入记录，不能校验。");
    const findings:AuthorFinding[]=[];
    if(!c.checks.length)findings.push({label:"实际结果或产物校验规则",equal:false,reason:"missing-check",hint:"尚未配置比较规则；完成试运行不代表结果通过。"});
    // File grants are only needed when comparing a selected file. Existing
    // result/artifact checks remain usable after their input file is removed.
    let fileOps:AppFileOperations|undefined,values:Record<string,import("./automation-app-run").AppJson>={};
    if(c.checks.some(check=>check.source==="file")){
      values=await appRunValue(a,c.id,run.id,input.inputRef) as typeof values;
      const grants=await new AutomationAppFiles(a.store,detail).validateReferences(values,c.digest);
      fileOps=new AppFileOperations(a.store.workspaceDirectory(c.id),grants,detail.manifest.automation.capabilities,a.assertIdentity);
    }
    for(const check of c.checks){
      const finding:AuthorFinding={label:`${check.source}:${check.name??check.fieldId??""}${check.path??""}`,equal:false};
      try {
        let actual:unknown=result;
        if(check.source==="artifact"){
          const artifact=run.artifacts.find(value=>value.name===check.name);if(!artifact)throw new Error("实际产物不存在。");
          const {bytes}=await appRunArtifact(a,c.id,run.id,artifact.id);actual=check.path===undefined?bytes.toString("utf8"):JSON.parse(bytes.toString("utf8"));
        }
        if(check.source==="file"){const ref=values[check.fieldId!] as Record<string,unknown>;actual=await fileOps!.call(check.format==="json"?"readJson":"readText",[{...ref,...(check.relative?{relative:check.relative}:{})}]);}
        actual=authorValueAt(actual,check.path??"");let expected:unknown=check.expected;
        if(check.evidenceId){const evidence=s.evidence.find(entry=>entry.id===check.evidenceId);if(!evidence){finding.reason="missing-evidence";throw new Error("缺少本任务的实际字段证据，不能用试运行结果自行充当证据。");}expected=authorValueAt(evidence.value,check.evidencePath??"");}
        finding.equal=authorEqual(actual,expected);
        if(!finding.equal){finding.reason="value-mismatch";finding.hint="实际结果与所选证据或预期不同；请核对对象和字段，不能跳过该记录。";}
      }catch(error){finding.reason??=error instanceof Error&&error.message.includes("字段缺失")?"missing-field":"read-error";finding.hint=error instanceof Error?error.message:"实际数据未能完成读取或比较。";}
      findings.push(finding);
    }
    findings.push(...authorColumnCoverage(detail,c.checks,result));
    const caps=detail.manifest.automation.capabilities;
    if(caps.includes("files.write"))findings.push({label:"实际文件或产物内容校验",equal:c.checks.some(check=>["file","artifact"].includes(check.source)),reason:"missing-check",hint:"需比较实际生成文件或产物的内容。"});
    if(caps.includes("browser.read")&&!caps.includes("browser.write"))findings.push({label:"本任务实际网页字段证据",equal:!checkPlan.needsWebEvidence,reason:"missing-evidence",hint:"需引用本任务 read/extract 的 evidenceId；仅查询状态或成功标志不足以验证字段。"});
    if(caps.includes("browser.write"))findings.push({label:"实际网页变更状态校验",equal:run.events.some(event=>event.kind==="log"&&event.status==="browser"&&event.message==="网页变更的页面状态已校验"),reason:"missing-evidence",hint:"需有真实变更后的页面状态验证。"});
    c.validation={status:findings.every(finding=>finding.equal)?"passed":"failed",runId:run.id,digest:c.digest,at:new Date().toISOString(),checks:findings};await write(a,s);return {...c.validation,checkPlan,evidenceWarnings:s.evidenceWarnings};
  });
}
export async function saveAuthor(task:AutomationTaskRef,digest:string,displayName?:unknown){const a=await authorAccess(task);return locked(a,async s=>{const c=s.candidate;if(!c||c.digest!==digest)fail("待保存代码已变化，请重新查看。");if(c.saved)return c.saved;if(c.validation?.status!=="passed"||c.validation.digest!==digest||c.validation.runId!==c.runId)fail("当前代码尚未通过实际试运行校验。");
  const run=await getAppRun(a,c.id,c.runId!);if(run.status!=="completed"||run.digest!==digest)fail("试运行状态已变化。");await assertAppIdle(a.store.dataDirectory(c.id));const exported=await a.store.export(c.id),source=inspectAutomationFiles((await import("./automation-app-package")).parseAutomationAppArchive(exported.bytes).files);
  if(source.digest!==digest)fail("待保存包与已校验的代码不一致。");
  const old=await a.host.find(c.id);if(c.saveIntent?.digest===digest&&old?.activeVersion===source.manifest.version&&old.versions.some(v=>v.version===source.manifest.version&&v.digest===(c.saveIntent!.publishedDigest??digest))){c.saved={id:old.id,version:old.activeVersion,at:new Date().toISOString(),displayName:c.saveIntent.displayName??source.manifest.displayName};await write(a,s);return c.saved;}
  if(task.baseApp?(old?.revision!==task.baseApp.revision||old.activeVersion!==task.baseApp.version):Boolean(old))fail("应用登记已变化，请重新从目录创建修改任务。");
  const pkg=withAutomationAppName(source,displayName);
  c.saveIntent={digest,revision:old?.revision??0,publishedDigest:pkg.digest,displayName:pkg.manifest.displayName};await write(a,s);const install=await a.host.install(pkg,c.saveIntent.revision);c.saved={id:install.id,version:install.activeVersion,at:new Date().toISOString(),displayName:pkg.manifest.displayName};await write(a,s);return c.saved;});}
export async function authorSnapshot(a:Access,collectEvidence=false){
  if(collectEvidence)await locked(a,async state=>{const c=state.candidate;if(c?.runId){const run=await getAppRun(a,c.id,c.runId);await collectRunEvidence(a,state,run);await write(a,state);}});
  let state=await readAuthor(a);
  if(state.explorer&&appRunActive(state.explorer.run.status)&&state.explorer.run.serverPid!==process.pid&&!a.actor.browser){await patch(a,s=>{if(s.explorer&&appRunActive(s.explorer.run.status)&&s.explorer.run.serverPid!==process.pid){s.explorer.run.status="interrupted";s.explorer.run.finishedAt=new Date().toISOString();s.explorer.run.error="开发服务或执行进程已重启，原网页探索已中断；刷新不会重新执行旧操作。";delete s.explorer.run.question;delete s.explorer.run.browserApproval;}});state=await readAuthor(a);}
  const c=state.candidate;return {task:a.task,sessionId:a.doc.sessionId,active:a.doc.status==="active"&&a.actor.blockedAt!==a.doc.updatedAt,goal:a.doc.goal,state,ownerKey:a.ownerKey,runtimeId:a.runtimeId,...(c?{detail:await a.store.detail(c.id),...(c.runId?{run:await getAppRun(a,c.id,c.runId)}:{})}:{})};
}
export async function authorFile(task:AutomationTaskRef,fieldId:string,method:string,relative?:string){const a=await authorAccess(task);if(!["list","readText","readJson"].includes(method))fail("仅开放已选文件的读取探索。");const s=await readAuthor(a),c=s.candidate;if(!c)fail("先生成带文件配置项的草稿，由用户选择业务文件。");const detail=await a.store.detail(c.id),config=await readAppConfiguration(a,c.id),grants=await new AutomationAppFiles(a.store,detail).validateReferences(config.values,c.digest),ref=config.values[fieldId];if(!ref||typeof ref!=="object"||Array.isArray(ref))fail("请在对话中的配置卡片选择并保存该文件。");const value=appJsonValue(await new AppFileOperations(a.store.workspaceDirectory(c.id),grants,detail.manifest.automation.capabilities,a.assertIdentity).call(method,[{...ref,...(relative?{relative}:{})}]),256000),evidenceId=randomUUID();await patch(a,s=>{s.evidence.push({id:evidenceId,method:"file."+method,at:new Date().toISOString(),value});});return {evidenceId,value};}
