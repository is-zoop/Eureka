import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti=createJiti(import.meta.url,{tsconfigPaths:true,alias:{"server-only":resolve("node_modules/next/dist/compiled/server-only/empty.js")}});
const {localAutomationContext,assertLocalAutomationNamespace}=await jiti.import("./automation-local-context.ts");
const {LocalAutomationAppStore}=await jiti.import("./automation-local-store.ts");
const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
const {fileAutomationExample}=await jiti.import("./automation-app-example.ts");
const {copyAutomationAppPackage}=await jiti.import("./automation-app-metadata.ts");
const {startAppRun,getAppRun,stopAppRun,saveAppConfiguration,readAppConfiguration,appRunValue}=await jiti.import("./automation-app-runtime.ts");
const {appHasLease}=await jiti.import("./automation-app-lease.ts");
const {readAutomationTask}=await jiti.import("./automation-mode-store.ts");
const {cacheSessionPath,invalidateSessionPathCache}=await jiti.import("./session-reader.ts");
const tasksRoute=await jiti.import("../app/api/automation/tasks/route.ts");
const authorRoute=await jiti.import("../app/api/automation/authoring/route.ts");
const publicationRoute=await jiti.import("../app/api/automation/apps/[id]/publication/route.ts");
const {automationAppAccess}=await jiti.import("./automation-app-server.ts");
const {hazeAutomationAccess,DraftIdentityError}=await jiti.import("./automation-access.ts");
const {automationTaskOwner,assertAutomationTaskOwner}=await jiti.import("./automation-task-owner.ts");
const {taskAllowsClarification}=await jiti.import("./composer-plugins.ts");
const {bindChatAutomations,listAutomationComposerApps,prepareComposerSelection}=await jiti.import("./automation-chat.ts");
const {requiresCloudPluginSelection}=await jiti.import("./plugin-selection.ts");
const {ClarificationRuntime}=await jiti.import("./clarification-runtime.ts");
const {EUREKA_AUTOMATION_CHAT_EXTENSION}=await jiti.import("./automation-chat-extension.ts");
const first="a".repeat(64),second="b".repeat(64);
async function fixture(work){
 const root=await mkdtemp(join(tmpdir(),"eureka-local-")),base=join(root,"agent"),keys=["PI_CODING_AGENT_DIR","EUREKA_AUTH_HAZE_ISSUER","EUREKA_AUTH_CLIENT_ID","EUREKA_AUTH_REDIRECT_URI","EUREKA_AUTH_SESSION_SECRET"],previous=new Map(keys.map(key=>[key,process.env[key]]));
 for(const key of keys)delete process.env[key];process.env.PI_CODING_AGENT_DIR=base;
 await mkdir(join(base,"app-data",first),{recursive:true});await mkdir(join(base,"app-data",second),{recursive:true});
 const local=localAutomationContext(base),store=new LocalAutomationAppStore(base,local.ownerKey,local.assertIdentity),auth={...local,store};
 try{await work({root,base,local,store,auth});}finally{for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}assert.equal(dirname(root),tmpdir());await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
function simplePackage(){const original=parseAutomationAppArchive(fileAutomationExample()),files=new Map(original.files);files.set("ui.json",Buffer.from(JSON.stringify({schemaVersion:1,fields:[],buttons:[{id:"run",label:"Run",action:"run"}],results:{columns:[]}})));files.set("workflow.json",Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:"local",label:"Local",kind:"script"}],edges:[]})));files.set("scripts/main.mjs",Buffer.from('export default async ctx=>ctx.step("local",null,async()=>{await ctx.sleep(300);return {local:true};});'));return inspectAutomationFiles(files);}
test("local workspace identity persists through Haze login changes without reading credentials",async()=>fixture(async({base,local})=>{
 assert.equal(local.ownerKey,first);await writeFile(join(base,"eureka-haze-runtime-session.json"),JSON.stringify({fixture:"different-login"}));
 const after=localAutomationContext(base);assert.equal(after.workspaceId,local.workspaceId);assert.equal(after.runtimeId,local.runtimeId);local.assertIdentity();
}));
test("local catalog reads and edits multiple legacy namespaces in place",async()=>fixture(async({base,local})=>{
 const pkg=simplePackage(),a=new AutomationAppStore(base,first,()=>{}),b=new AutomationAppStore(base,second,()=>{});await a.install(pkg,0);const copied=copyAutomationAppPackage(pkg,randomUUID(),"Second");const install=await b.install(copied,0);
 const store=new LocalAutomationAppStore(base,local.ownerKey,local.assertIdentity);assert.equal((await store.list()).apps.length,2);assert.equal((await store.detail(install.id)).dataDirectory,b.dataDirectory(install.id));
 await saveAppConfiguration({...local,store},install.id,install.revision,0,{});assert.equal(JSON.parse(await readFile(join(b.dataDirectory(install.id),"config.json"),"utf8")).revision,1);
 assert.equal((await a.find(pkg.manifest.automation.id)).id,pkg.manifest.automation.id);
}));
test("duplicate legacy IDs remain intact and cannot silently select another package",async()=>fixture(async({base,local})=>{
 const pkg=simplePackage();for(const owner of [first,second])await new AutomationAppStore(base,owner,()=>{}).install(pkg,0);
 const store=new LocalAutomationAppStore(base,local.ownerKey,local.assertIdentity);assert((await store.list()).apps[0].error);await assert.rejects(store.detail(pkg.manifest.automation.id),/同 ID/);
 for(const owner of [first,second])assert(await new AutomationAppStore(base,owner,()=>{}).find(pkg.manifest.automation.id));
}));
test("guest checkpoint recovery needs no Haze login and remains local across login changes",async()=>fixture(async({base,auth,store})=>{
 const files=new Map(simplePackage().files),plugin=JSON.parse(files.get('plugin.json'));
 plugin.extensions['com.eureka'].automation.checkpoints={schemaVersion:1};files.set('plugin.json',Buffer.from(JSON.stringify(plugin)));
 files.set('scripts/main.mjs',Buffer.from(`export default async ctx=>ctx.step('local',null,async()=>{const saved=await ctx.checkpoints.load();if(saved)return {next:saved.state.next,local:true};await ctx.checkpoints.save('batch-1',{next:2});throw new Error('fixture interruption');});`));
 const install=await store.install(inspectAutomationFiles(files),0),firstRun=randomUUID();
 const terminal=async id=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const run=await getAppRun(auth,install.id,id);if(!['running','waiting-user','cancelling'].includes(run.status)&&!await appHasLease(store.dataDirectory(install.id)))return run;await delay(40);}throw new Error('local checkpoint fixture timed out');};
 const runs=[firstRun];
 try{
 await startAppRun(auth,install.id,install.revision,firstRun,{},0);const failed=await terminal(firstRun);assert.equal(failed.status,'failed');assert.equal(failed.checkpoint.unsafe,false);
 await writeFile(join(base,'eureka-haze-runtime-session.json'),JSON.stringify({fixture:'different-cloud-login'}));
 const secondRun=randomUUID();runs.push(secondRun);await startAppRun(auth,install.id,install.revision,secondRun,{},(await readAppConfiguration(auth,install.id)).revision,undefined,{resumeFrom:firstRun});
 const done=await terminal(secondRun);assert.equal(done.status,'completed',done.error);assert.equal(done.resumedFrom,firstRun);assert.deepEqual(await appRunValue(auth,install.id,secondRun,done.resultRef),{next:2,local:true});
 }finally{for(const id of runs){try{const run=await getAppRun(auth,install.id,id);if(['running','waiting-user','cancelling'].includes(run.status))await stopAppRun(auth,install.id,id);}catch(error){if(error.code!=='ENOENT')throw error;}}const deadline=Date.now()+5000;while(await appHasLease(store.dataDirectory(install.id))&&Date.now()<deadline)await delay(25);}
}));

test("a local run completes while the Haze login file changes",async()=>fixture(async({base,local})=>{
 const pkg=simplePackage(),original=new AutomationAppStore(base,second,()=>{}),install=await original.install(pkg,0),store=new LocalAutomationAppStore(base,local.ownerKey,local.assertIdentity),auth={...local,store},id=randomUUID();
 await startAppRun(auth,install.id,install.revision,id,{},0);await writeFile(join(base,"eureka-haze-runtime-session.json"),JSON.stringify({fixture:"logged-out"}));
 try{const deadline=Date.now()+15000;let run;while(Date.now()<deadline){run=await getAppRun(auth,install.id,id);if(["completed","failed","interrupted"].includes(run.status))break;await delay(40);}assert.equal(run.status,"completed",run.error);}finally{const run=await getAppRun(auth,install.id,id);if(["running","waiting-user","cancelling"].includes(run.status))await stopAppRun(auth,install.id,id);const deadline=Date.now()+5000;while(await appHasLease(store.dataDirectory(install.id))&&Date.now()<deadline)await delay(25);}
}));
test("guest task and authoring endpoints recover a retired login without rewriting history",async()=>fixture(async({base,local})=>{
 const id=randomUUID(),sid=randomUUID(),task={id,ownerKey:second,runtimeId:"retired-login"},stamp=new Date().toISOString(),directory=join(base,"app-data",second,"creation",id),record={version:1,task,sessionId:sid,status:"active",createdAt:stamp,updatedAt:stamp,goal:"Local draft"};
 await mkdir(directory,{recursive:true});await writeFile(join(directory,"task.json"),JSON.stringify(record));await writeFile(join(directory,"author.json"),JSON.stringify({schemaVersion:1,evidence:[]}));
 const sessions=join(base,"sessions","fixture");await mkdir(sessions,{recursive:true});const file=join(sessions,sid+".jsonl");await writeFile(file,[{type:"session",version:3,id:sid,cwd:base,timestamp:stamp},{type:"custom",id:"a0000001",parentId:null,timestamp:stamp,customType:"eureka_automation_mode",data:{task,sessionId:sid,status:"active",updatedAt:stamp}}].map(v=>JSON.stringify(v)).join("\n")+"\n");cacheSessionPath(sid,file);
 try{const restored=await readAutomationTask(task);assert.equal(restored.task.runtimeId,local.runtimeId);assert.equal(restored.task.ownerKey,second);
 for(const route of [tasksRoute,authorRoute]){const response=await route.GET(new Request(`http://127.0.0.1:8080/api/automation/authoring?sessionId=${sid}`,{headers:{host:"127.0.0.1:8080"}}));assert.equal(response.status,200,await response.clone().text());const value=await response.json();assert.equal(value.runtimeId,local.runtimeId);assert.equal(value.ownerKey,second);}
 assert.deepEqual(JSON.parse(await readFile(join(directory,"task.json"),"utf8")),record);
 }finally{invalidateSessionPathCache(sid);}
}));
test("cloud publication still requires Haze authentication",async()=>fixture(async({base,local})=>{
 const pkg=simplePackage();await new AutomationAppStore(base,first,()=>{}).install(pkg,0);const query=new URLSearchParams({ownerKey:local.ownerKey,runtimeId:local.runtimeId});const request=new Request(`http://127.0.0.1:8080/api/automation/apps/${pkg.manifest.automation.id}/publication?${query}`,{headers:{host:"127.0.0.1:8080"}});
 await automationAppAccess(request,local);
 await assert.rejects(hazeAutomationAccess(),error=>error instanceof DraftIdentityError);
 const response=await publicationRoute.GET(request,{params:Promise.resolve({id:pkg.manifest.automation.id})});assert.equal(response.status,401,await response.clone().text());
}));
test("legacy namespace discovery rejects junctions outside local data",async()=>fixture(async({root,base})=>{
 const outside=join(root,"outside");await mkdir(outside);const owner="c".repeat(64);await symlink(outside,join(base,"app-data",owner),process.platform==="win32"?"junction":"dir");assert.throws(()=>assertLocalAutomationNamespace(owner,base),/不存在/);
}));

test("guest conversation tools select and run a local application through the real step protocol",async()=>fixture(async({base,local,store})=>{
 const pkg=simplePackage(),install=await store.install(pkg,0),sid=randomUUID(),entries=[];
 const manager={getSessionId:()=>sid,getEntries:()=>entries,getBranch:()=>entries,appendCustomEntry:(customType,data)=>entries.push({type:"custom",customType,data})};
 const available=await listAutomationComposerApps(base),selected=available.filter(app=>app.automation.id===install.id);
 assert.equal(selected.length,1);assert.equal(requiresCloudPluginSelection(selected),false);
 assert.equal(requiresCloudPluginSelection([...selected,{source:"https://cloud.example",capabilityId:"42"}]),true);
 const prepared=await prepareComposerSelection(base,sid,selected,[],"运行本地应用");assert.equal(prepared.automations.length,1);
 const controller=new ClarificationRuntime(manager,()=>{}),owner=automationTaskOwner(false,selected);
 controller.task={id:randomUUID(),plugins:selected,owner,clarificationEnabled:false};
 controller.allowed=taskAllowsClarification(base,sid,controller.task);assert.equal(controller.allowed,true);
 const unbind=bindChatAutomations(manager,selected),tools=new Map();EUREKA_AUTOMATION_CHAT_EXTENSION.factory({registerTool:tool=>tools.set(tool.name,tool),on:()=>{}});
 const call=async(mode,extra={})=>JSON.parse((await tools.get("eureka_automation_run").execute(randomUUID(),{mode,appId:install.id,...extra},undefined,()=>{},{cwd:base,sessionManager:manager})).content[0].text);
 let runId;
 try{
  const start=await call("start");runId=start.runId;assert.equal(start.pendingSteps.length,1);
  await writeFile(join(base,"eureka-haze-runtime-session.json"),JSON.stringify({fixture:"another-cloud-login"}));assertAutomationTaskOwner(owner);
  let result=await call("next",{stepToken:start.pendingSteps[0].stepToken});const deadline=Date.now()+5000;
  while(result.status!=="completed"&&Date.now()<deadline){await delay(25);result=await call("status");}
  assert.equal(result.status,"completed",result.error);assert.deepEqual(result.result,{local:true});assert.equal(result.runId,runId);
 }finally{unbind();controller.dispose();if(runId){const auth={...local,store};const run=await getAppRun(auth,install.id,runId);if(["running","waiting-user","waiting-browser"].includes(run.status))await stopAppRun(auth,install.id,runId);const deadline=Date.now()+5000;while(await appHasLease(store.dataDirectory(install.id),runId)&&Date.now()<deadline)await delay(25);}}
}));

test("local task ownership rejects a reset workspace and unrelated cloud selections remain authenticated",async()=>fixture(async({base,local})=>{
 const owner=automationTaskOwner(true,[]);assertAutomationTaskOwner(owner);
 await writeFile(join(base,"eureka-local-automation.json"),JSON.stringify({schemaVersion:1,workspaceId:randomUUID(),ownerKey:local.ownerKey}));
 assert.throws(()=>assertAutomationTaskOwner(owner),/工作区已变化/);assert.throws(local.assertIdentity,/工作区已变化/);
 assert.throws(()=>assertAutomationTaskOwner({source:"https://cloud.example",subject:"cloud-user"}),/云端身份/);
}));
