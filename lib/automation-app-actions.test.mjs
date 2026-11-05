// Regression sources only. Execute manually; no real browser, model or user files.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {multiActionAutomationFixture}=await jiti.import("./test-fixtures/automation-multi-actions.ts");
const {fileAutomationExample}=await jiti.import("./automation-app-example.ts");
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
const {appActions,appActionDetail,appActionConfigurationScope}=await jiti.import("./automation-app-actions.ts");
const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
const {readAppConfiguration,saveAppConfiguration,startAppRun,getAppRun,listAppRuns,appRunValue,stopAppRun}=await jiti.import("./automation-app-runtime.ts");
const {appHasLease}=await jiti.import("./automation-app-lease.ts");
const {appParameters}=await jiti.import("./automation-app-run.ts");
const {activateAuthorAction,rememberAuthorAction,authorActionsPassed}=await jiti.import("./automation-authoring-types.ts");
const {prepareChatInvocation,chatInvocationResult,configureChatInvocation}=await jiti.import("./automation-chat.ts");
const until=async(read,match)=>{for(let i=0;i<200;i++){const value=await read();if(match(value))return value;await delay(35);}throw new Error("fixture did not settle");};
async function fixture(work){const root=await mkdtemp(join(tmpdir(),"eureka-actions-")),owner="a".repeat(64),store=new AutomationAppStore(root,owner,()=>{});const pkg=parseAutomationAppArchive(multiActionAutomationFixture()),install=await store.install(pkg,0),auth={ownerKey:owner,runtimeId:"test-login",store,assertIdentity:()=>{}};try{await work({root,store,pkg,install,auth});}finally{for(const run of await listAppRuns(auth,install.id))if(["running","waiting-user","waiting-browser","cancelling"].includes(run.status))await stopAppRun(auth,install.id,run.id);await until(()=>appHasLease(store.dataDirectory(install.id)),held=>!held);await rm(root,{recursive:true,force:true});}}

test("a package declares independent entries, fields, graphs and result columns; old apps still resolve",()=>{
  const pkg=parseAutomationAppArchive(multiActionAutomationFixture());
  assert.deepEqual(appActions(pkg).map(a=>a.id),["count","uppercase","dedupe"]);
  assert.deepEqual(pkg.actions.map(a=>a.graph.nodes.length),[2,3,4]);
  assert.equal(appActionDetail(pkg,"uppercase").manifest.automation.entry,"scripts/uppercase.mjs");
  assert.equal(appActionDetail(pkg,"dedupe").ui.results.columns[0].key,"value");
  assert.throws(()=>appActionDetail(pkg,"missing"),/功能不存在/);
  const old=parseAutomationAppArchive(fileAutomationExample());
  assert.equal(appActions(old).length,1);
  assert.equal(appActionConfigurationScope(appActionDetail(old)),undefined);
  const broken=new Map(pkg.files),manifest=JSON.parse(broken.get("plugin.json"));
  manifest.extensions["com.eureka"].automation.actions[1].id="count";
  broken.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  assert.throws(()=>inspectAutomationFiles(broken),/重复/);
  manifest.extensions["com.eureka"].automation.actions[1].id="uppercase";
  manifest.extensions["com.eureka"].automation.actions[1].capabilities=["browser.write"];
  broken.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  assert.throws(()=>inspectAutomationFiles(broken),/功能能力/);
  const ownFields=new Map(pkg.files),ui=JSON.parse(ownFields.get("ui/uppercase.json"));
  ui.fields.push({id:"suffix",label:"后缀",type:"text",required:true});ownFields.set("ui/uppercase.json",Buffer.from(JSON.stringify(ui)));
  const different=inspectAutomationFiles(ownFields);
  assert.doesNotThrow(()=>appParameters(appActionDetail(different,"count").ui,{text:"abc"},true));
  assert.throws(()=>appParameters(appActionDetail(different,"uppercase").ui,{text:"abc"},true),/后缀/);
});

test("each function owns its config revision and actual execution graph/results",()=>fixture(async({auth,store,install})=>{
  const inputs={count:"abc\nxx",uppercase:"hello",dedupe:"a\na\nb"};
  const expected={count:[{characters:6,lines:2}],uppercase:[{output:"HELLO"}],dedupe:[{value:"a"},{value:"b"}]};
  for(const [action,text]of Object.entries(inputs)){
    assert.equal((await readAppConfiguration(auth,install.id,action)).revision,0);
    await saveAppConfiguration(auth,install.id,install.revision,0,{text},action);
  }
  for(const [index,[action,text]]of Object.entries(inputs).entries()){
    const config=await readAppConfiguration(auth,install.id,action),id=randomUUID();
    await startAppRun(auth,install.id,install.revision,id,config.values,config.revision,action);
    const run=await until(()=>getAppRun(auth,install.id,id),r=>["completed","failed"].includes(r.status));
    assert.equal(run.status,"completed",run.error);assert.equal(run.actionId,action);
    assert.equal(run.entryScript,`scripts/${action}.mjs`);
    assert.equal(run.workflow.nodes.length,index+2);
    assert.deepEqual(await appRunValue(auth,install.id,id,run.resultRef),expected[action]);
    assert.equal(run.events.filter(e=>e.kind==="node"&&e.status==="completed").length,index+2);
    assert.deepEqual(run.events.filter(e=>e.kind==="node"&&e.status==="completed").map(e=>e.nodeId),run.workflow.nodes.map(node=>node.id));
    assert.equal(run.artifacts.length,0);
    await until(()=>appHasLease(store.dataDirectory(install.id)),held=>!held);
    assert.equal((await listAppRuns(auth,install.id,action)).length,1);
    assert.equal((await readAppConfiguration(auth,install.id,action)).values.text,text);
    for(const [other,value]of Object.entries(inputs))assert.equal((await readAppConfiguration(auth,install.id,other)).values.text,value);
  }
  const exported=parseAutomationAppArchive((await store.export(install.id)).bytes);
  assert.equal(exported.actions.length,3);
  assert.ok(![...exported.files.keys()].some(path=>/action-config|action-grants|logs|artifacts/.test(path)));
}));

test("chat exposes all functions but prepares and configures only the selected function",()=>fixture(async({auth,install})=>{
  const app={source:"local-automation",capabilityId:install.id,name:"文本处理工具箱",automation:{id:install.id,revision:install.revision}},session=randomUUID(),task=randomUUID();
  const one=await prepareChatInvocation(auth,session,task,app,{},"count");
  await configureChatInvocation(auth,one,{text:"count input"},true,0);
  const two=await prepareChatInvocation(auth,session,task,app,{},"uppercase");
  assert.notEqual(one.id,two.id);
  assert.equal((await readAppConfiguration(auth,install.id,"uppercase")).revision,0);
  const snapshot=await chatInvocationResult(auth,two);
  assert.equal(snapshot.actionId,"uppercase");assert.equal(snapshot.actions.length,3);
  assert.equal(snapshot.workflow.nodes.length,3);
  assert.equal((await readAppConfiguration(auth,install.id,"count")).values.text,"count input");
}));

test("validating one function cannot validate the entire application",()=>{
  const pkg=parseAutomationAppArchive(multiActionAutomationFixture());
  const candidate={id:pkg.manifest.automation.id,digest:pkg.digest,revision:1,scope:[],limitations:[],checks:[],actionId:"count",actionTrials:{}};
  for(const action of ["count","uppercase","dedupe"]){
    activateAuthorAction(candidate,action);candidate.checks=[{source:"result",expected:[]}];candidate.runId=randomUUID();candidate.validation={status:"passed",digest:candidate.digest,runId:candidate.runId,at:new Date().toISOString(),checks:[]};rememberAuthorAction(candidate);
    assert.equal(authorActionsPassed(candidate,pkg),action==="dedupe");
  }
  const first=candidate.actionTrials.count.runId;activateAuthorAction(candidate,"count");assert.equal(candidate.runId,first);
  candidate.digest="changed";assert.equal(authorActionsPassed(candidate,pkg),false);
});
