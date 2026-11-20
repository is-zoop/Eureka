// Test sources only. Run manually; no real browser, login or business website.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true,alias:{"server-only":resolve("node_modules/next/dist/compiled/server-only/empty.js")}});
const {parseAppBrowser,parseAppLocator,parseAppPageField,appSiteAllows}=await jiti.import("../../features/automation/runtime/automation-app-browser.ts");
const {browserAutomationExample}=await jiti.import("../../features/automation/runtime/automation-app-browser-example.ts");
const {parseAutomationAppArchive}=await jiti.import("../../features/automation/runtime/automation-app-package.ts");
const {AutomationAppStore}=await jiti.import("../../features/automation/runtime/automation-app-store.ts");
const {ApplicationBrowserRuntime,consumeAppBrowserTicket,checkAppBrowserTicket}=await jiti.import("../../features/automation/runtime/automation-app-browser-runtime.ts");

test("arbitrary page fields and semantic locators are typed; malformed declarations fail closed",()=>{
  for(const type of ["text","number","date","percentage","boolean","object","list"])assert.equal(parseAppPageField({locator:{css:".value"},type}).type,type);
  assert.deepEqual(parseAppLocator({role:"button",name:"查询",within:{testId:"toolbar"}}),{role:"button",name:"查询",within:{testId:"toolbar"}});
  for(const v of [{source:["text"]},{type:["number"]},{source:"attribute",attribute:"data-token"},{source:"attribute",attribute:"value"}])assert.throws(()=>parseAppPageField(v));
  assert.throws(()=>parseAppLocator({css:"button",text:"确认"}));
  assert.throws(()=>parseAppLocator({css:"button",nth:-1}));
  assert.equal(parseAppLocator({css:"button",context:[{kind:"frame",locator:{css:"#frame"}},{kind:"shadow",locator:{css:"grid-app"}}]}).context.length,2);
  for(const context of [[{kind:"cross-origin",locator:{css:"iframe"}}],Array.from({length:4},()=>({kind:"shadow",locator:{css:"grid-app"}}))])assert.throws(()=>parseAppLocator({css:"button",context}));
});
test("package scopes reject credential URLs, missing write grants and unverified mutations",()=>{
  const pkg=parseAutomationAppArchive(browserAutomationExample("operations")), web=pkg.manifest.automation.browser;
  assert.equal(appSiteAllows(web.sites[0],"http://127.0.0.1:8080/automation-app-demo.html?view=operations"),true);
  assert.equal(appSiteAllows(web.sites[0],"http://127.0.0.1:8080/unrelated"),false);
  assert.equal(appSiteAllows(web.sites[0],"http://localhost:8080/automation-app-demo.html"),false);
  assert.throws(()=>parseAppBrowser(web,["browser.read"]));
  const missing=structuredClone(web); delete missing.sites[0].operations[0].verify;
  assert.throws(()=>parseAppBrowser(missing,["browser.read","browser.write"]));
  const noAccount=structuredClone(web);delete noAccount.sites[0].account;
  assert.throws(()=>parseAppBrowser(noAccount,["browser.read","browser.write"]));
  const query=parseAutomationAppArchive(browserAutomationExample("queries"));
  assert.deepEqual(query.manifest.automation.browser.sites.map(s=>s.id),["products","marketing"]);
  assert.equal(query.workflow.nodes.length,4);
});
async function until(read,match){for(let i=0;i<500;i++){const value=await read();if(match(value))return value;await delay(10);}throw new Error("fixture wait timed out");}
async function fixture(work,kind="operations",captureReads=false,extra={}){
  const root=await mkdtemp(join(tmpdir(),"eureka-a04-")),owner="a".repeat(64),store=new AutomationAppStore(root,owner,()=>{});
  const pkg=parseAutomationAppArchive(browserAutomationExample(kind)),installed=await store.install(pkg,0),detail=await store.detail(installed.id);
  let live=true,approval=null,unknown=0,account="演示账号 A",scope=false,authRequired=false;
  const loginQuestions=[],audit=[],connections=[];let readValue=0,requestCalls=0,requestData;
  const service=new ApplicationBrowserRuntime({ownerKey:owner,runtimeId:"test-login",runId:randomUUID(),detail,store,captureReads,...extra,
    check:()=>{if(!live)throw new Error("stopped");},connection:async waiting=>{connections.push(waiting);},askLogin:async message=>{loginQuestions.push(message);account="演示账号 A";scope=false;authRequired=false;},showApproval:async a=>{approval=a;},saveSession:async()=>{},audit:async(message,value)=>{audit.push({message,value});},unknownOutcome:async()=>{unknown++;live=false;}});
  const bridge=randomUUID();let stopPump=false,reply=true,repeat=false,lastTicket="",pumping=true;
  const pump=(async()=>{while(!stopPump){try{
    const pending=pumping?service.presence(bridge):null;if(pending){const {lease,command}=service.claim(pending.id,bridge),request=JSON.parse(command.payload);
      if(["open","release"].includes(command.method))service.complete(command.id,lease,{ok:true});
      else {const token=await service.arm(command.id,lease);lastTicket=token;await consumeAppBrowserTicket(token,command.payload);
        if(repeat)await assert.rejects(()=>consumeAppBrowserTicket(token,command.payload));
        if(command.method==="request")requestCalls++;
        const result=command.method==="probe"?{origin:scope?"https://login.example.test":"http://127.0.0.1:8080",environment:"account:default:1",account:scope||!request.site.account?null:account,outOfScope:scope,authRequired}:command.method==="request"?{status:200,data:requestData??{...(request.args.input.query?.itemId!==undefined?{itemId:request.args.input.query.itemId}:{}),quantity:0},dispatched:true,verified:reply}:command.method==="operation"?{dispatched:true,verified:reply,before:false,after:request.args.input.value??null}:{value:readValue};
        service.complete(command.id,lease,result);
      }
    }
  }catch(e){if(live&&!stopPump&&!/网页运行已停止|stopped/.test(e.message))throw e;}await delay(5);}})();
  try{await work({service,store,detail,loginQuestions,audit,connections,bridge,set pumping(value){pumping=value;},get approval(){return approval;},get unknown(){return unknown;},get requestCalls(){return requestCalls;},get lastTicket(){return lastTicket;},set account(v){account=v;},set scope(v){scope=v;},set authRequired(v){authRequired=v;},set reply(v){reply=v;},set repeat(v){repeat=v;},set readValue(v){readValue=v;},set requestData(v){requestData=v;}});}
  finally{stopPump=true;service.close();await pump;await rm(root,{recursive:true,force:true});}
}

test("session API uses exact declared request, one-use gate and host read evidence",async()=>fixture(async f=>{
  const site=f.detail.manifest.automation.browser.sites[0];
  site.operations.push({id:"inventory",label:"Inventory",description:"Read quantity",effect:"query",kind:"request",request:{url:"https://inventory.example.test/query",method:"POST"}});
  await f.service.call("connect",[site.id]);f.repeat=true;
  const response=await f.service.call("request",["inventory",{query:{itemId:"00123"},form:{limit:"10"}}]);
  assert.deepEqual(response.data,{itemId:"00123",quantity:0});assert.equal(f.requestCalls,1);
  assert(f.audit.some(entry=>entry.message==="已记录网页字段证据"&&entry.value.args.requestId==="inventory"&&entry.value.value.data.quantity===0));
  await assert.rejects(()=>f.service.call("request",["inventory",{url:"https://other.example/"}]));
  await assert.rejects(()=>f.service.call("operation",["inventory",{}]));assert.equal(f.requestCalls,1);
},"operations",true));

test("browser uploads retain normal account approval and pass only prepared snapshots to the native gate",async()=>{
 let prepared=0,disposed=0;
 await fixture(async f=>{
 const site=f.detail.manifest.automation.browser.sites[0];site.operations.push({id:"uploadReport",label:"Upload report",description:"Upload fixture",effect:"mutation",kind:"upload",locator:{css:"#report"},upload:{contentTypes:["text/csv"]},verify:{field:{locator:{css:"#receipt"}},mode:"changed"}});
 await f.service.call("connect",[site.id]);
 const pending=f.service.call("operation",["uploadReport",{files:[{ref:{grantId:"approved"},filename:"report.csv",contentType:"text/csv"}]}]);void pending.catch(()=>{});
 const approval=await until(()=>f.approval,Boolean);assert.equal(prepared,0);await f.service.approve(approval.id,["uploadReport"]);
 assert.equal((await pending).verified,true);assert.equal(prepared,1);assert.equal(disposed,1);assert.equal((await f.service.grants())[0].operationId,"uploadReport");
 await assert.rejects(()=>f.service.call("operation",["uploadReport",{files:[{path:"C:/private",ref:{grantId:"approved"}}]}]),/引用/);
 },"operations",false,{prepareUpload:async(spec,input,browser)=>{assert.equal(browser,true);assert.equal(spec.multipart.files[0].contentTypes[0],"text/csv");assert.equal(input.multipart.files[0].ref.grantId,"approved");prepared++;return{input:{multipart:{files:[{name:"file",path:"C:/fixture/.eureka-upload-00000000000000000000000000000000/report.csv",filename:"report.csv",size:1,contentType:"text/csv"}]}},dispose:async()=>{disposed++;}};}});
});

test("active upload/auth checks validate liveness without redispatch or accepting changed payloads",async()=>fixture(async f=>{
 const site=f.detail.manifest.automation.browser.sites[0];site.operations.push({id:"authRead",label:"Auth read",description:"Fixture",effect:"query",kind:"request",request:{url:"https://api.example/read",method:"GET",credentials:"omit",auth:{kind:"bearer",credentialId:"shop"}}});
 await f.service.call("connect",[site.id]);f.pumping=false;
 const pending=f.service.call("request",["authRead",{}]);void pending.catch(()=>{});
 const command=await until(()=>f.service.presence(f.bridge),Boolean),claimed=f.service.claim(command.id,f.bridge),token=await f.service.arm(command.id,claimed.lease);
 await assert.rejects(()=>checkAppBrowserTicket(token,claimed.command.payload));await consumeAppBrowserTicket(token,claimed.command.payload);
 await checkAppBrowserTicket(token,claimed.command.payload);await checkAppBrowserTicket(token,claimed.command.payload);
 await assert.rejects(()=>checkAppBrowserTicket(token,claimed.command.payload+" "));await assert.rejects(()=>consumeAppBrowserTicket(token,claimed.command.payload));
 f.service.complete(command.id,claimed.lease,{status:200,data:{ok:true},dispatched:true});await pending;await assert.rejects(()=>checkAppBrowserTicket(token,claimed.command.payload));
}));

test("session API mutations return business responses without approval, account marker or DOM verification",async()=>fixture(async f=>{
  const site=f.detail.manifest.automation.browser.sites[0];
  delete site.account;
  site.operations.push({id:"updateApi",label:"Update",description:"Update quantity",effect:"mutation",kind:"request",request:{url:"https://inventory.example.test/update",method:"POST"}});
  await f.service.call("connect",[site.id]);f.reply=false;
  f.requestData={ok:true};
  const response=await f.service.call("request",["updateApi",{json:{quantity:10}}]);
  assert.deepEqual(response.data,{ok:true});assert.equal(f.approval,null);assert.equal(f.unknown,0);assert.equal(f.requestCalls,1);
  assert.equal((await f.service.grants()).length,0);assert.equal(f.loginQuestions.length,0);
  assert.ok(f.audit.some(entry=>entry.message==="API 响应已返回，业务结果由应用判断"));
  f.requestData={ok:false,message:"budget rejected"};
  const failed=await f.service.call("request",["updateApi",{json:{quantity:20}}]);
  assert.deepEqual(failed.data,{ok:false,message:"budget rejected"});assert.equal(f.requestCalls,2);assert.equal(f.unknown,0);
}));
test("API mutation accepts a receipt without verified and never replays a lost dispatched request",async()=>fixture(async f=>{
  const site=f.detail.manifest.automation.browser.sites[0];delete site.account;
  site.operations.push({id:"updateApi",label:"Update",description:"Update quantity",effect:"mutation",kind:"request",request:{url:"https://inventory.example.test/update",method:"POST"},verify:{field:{locator:{css:"#legacy-budget"}},mode:"changed"}});
  await f.service.call("connect",[site.id]);f.pumping=false;
  const first=f.service.call("request",["updateApi",{json:{quantity:10}}]);void first.catch(()=>{});
  const command=await until(()=>f.service.presence(f.bridge),Boolean),claimed=f.service.claim(command.id,f.bridge);
  const ticket=await f.service.arm(command.id,claimed.lease);await consumeAppBrowserTicket(ticket,claimed.command.payload);
  f.service.complete(command.id,claimed.lease,{status:200,data:{ok:true},dispatched:true});
  assert.deepEqual((await first).data,{ok:true});assert.equal(f.approval,null);assert.equal(f.unknown,0);
  const lost=f.service.call("request",["updateApi",{json:{quantity:20}}]);void lost.catch(()=>{});
  const next=await until(()=>f.service.presence(f.bridge),Boolean),lease=f.service.claim(next.id,f.bridge);
  const token=await f.service.arm(next.id,lease.lease);await consumeAppBrowserTicket(token,lease.command.payload);
  await f.service.detach(f.bridge);assert.equal(f.service.presence(randomUUID()),null);
  assert.equal(f.service.commandState(next.id),"dispatched");assert.equal(f.approval,null);
  f.service.commands.get(next.id).expiresAt=Date.now()-1;
  await assert.rejects(()=>lost,/结果未知/);assert.ok(f.unknown>0);
}));
for(const phase of ["claimed","dispatched"])test(`API errors retain the original cause and ${phase==="dispatched"?"stop uncertain dispatched writes":"do not claim an undispatched write was executed"}`,async()=>fixture(async f=>{
  const site=f.detail.manifest.automation.browser.sites[0];delete site.account;
  site.operations.push({id:"updateApi",label:"Update",description:"Update quantity",effect:"mutation",kind:"request",request:{url:"https://inventory.example.test/update",method:"POST"}});
  await f.service.call("connect",[site.id]);f.pumping=false;
  let stoppedReason="";const stop=f.service.options.unknownOutcome;
  f.service.options.unknownOutcome=async reason=>{assert.ok(f.audit.some(entry=>entry.value?.error==="API 变更缺少结果校验，结果未知，不重复提交"));stoppedReason=reason;await stop(reason);};
  const pending=f.service.call("request",["updateApi",{json:{quantity:10}}]);void pending.catch(()=>{});
  const command=await until(()=>f.service.presence(f.bridge),Boolean),claimed=f.service.claim(command.id,f.bridge);
  if(phase==="dispatched"){const ticket=await f.service.arm(command.id,claimed.lease);await consumeAppBrowserTicket(ticket,claimed.command.payload);}
  f.service.complete(command.id,claimed.lease,undefined,"API 变更缺少结果校验，结果未知，不重复提交");
  await assert.rejects(()=>pending,/API 变更缺少结果校验/);
  const diagnostic=f.audit.find(entry=>entry.value?.error==="API 变更缺少结果校验，结果未知，不重复提交");
  assert.equal(diagnostic.value.operationId,"updateApi");assert.equal(diagnostic.value.phase,phase);assert.equal(diagnostic.value.dispatched,phase==="dispatched");
  assert.equal(f.unknown,phase==="dispatched"?1:0);
  if(phase==="dispatched")assert.match(stoppedReason,/API 请求 updateApi失败：API 变更缺少结果校验/);
  else {assert.equal(stoppedReason,"");f.pumping=true;assert.equal((await f.service.call("request",["updateApi",{}])).status,200);}
}));
test("one-use native tickets, account-bound persisted scopes and revocation",async()=>fixture(async f=>{
  f.repeat=true;await f.service.call("connect",["settings"]);
  const op=f.service.call("operation",["enable",{value:true}]);void op.catch(()=>{});
  const approval=await until(()=>f.approval,Boolean);assert.equal(approval.account,"演示账号 A");
  await f.service.approve(approval.id,["enable"]);assert.equal((await op).verified,true);
  assert.equal((await f.service.grants()).length,1);
  const exported=parseAutomationAppArchive((await f.store.export(f.detail.install.id)).bytes);
  assert.ok(![...exported.files.keys()].some(name=>/grants|settings|logs|data|result/.test(name)));
  await f.service.call("operation",["enable",{value:false}]);assert.equal(f.approval,null);
  const grants=await f.service.grants();await f.store.privateJson(join(f.detail.dataDirectory,"browser-grants.json"),{schemaVersion:1,grants:grants.map(g=>({...g,revokedAt:new Date().toISOString()}))});
  const pending=f.service.call("operation",["enable",{value:true}]);void pending.catch(()=>{});
  assert.ok(await until(()=>f.approval,Boolean));f.service.close("denied");await assert.rejects(()=>pending);
}));

test("tasks share an environment reference, not pages or the browser execution slot",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);
  const first=f.service.nativeSession,sites=f.detail.manifest.automation.browser.sites;
  const marketing=await f.service.session(sites[1]);
  assert.notEqual(first.sessionId,marketing.native.sessionId);
  assert.equal(first.accountId,marketing.native.accountId);
  assert.equal((await f.service.session(sites[0])).native.sessionId,first.sessionId);
  const second=new ApplicationBrowserRuntime({...f.service.options,runId:randomUUID(),saveSession:async()=>{}});
  const bridge=randomUUID();let stopped=false;
  const pump=(async()=>{while(!stopped){
    const pending=second.presence(bridge);
    if(pending){
      const {lease,command}=second.claim(pending.id,bridge);
      if(["open","release"].includes(command.method))second.complete(command.id,lease,{ok:true});
      else {
        const token=await second.arm(command.id,lease);await consumeAppBrowserTicket(token,command.payload);
        second.complete(command.id,lease,{origin:"http://127.0.0.1:8080",environment:"account:default:1",account:"演示账号 A",outOfScope:false,authRequired:false});
      }
    }
    await delay(5);
  }})();
  try {
    // The first task deliberately remains connected while the second opens.
    await second.call("connect",["products"]);
    assert.notEqual(first.sessionId,second.nativeSession.sessionId);
    assert.equal(first.accountId,second.nativeSession.accountId);
    assert.equal(f.service.nativeSession.sessionId,first.sessionId);
  } finally { stopped=true;await pump;second.close(); }
  assert.equal(await f.service.call("read",[{locator:{css:"#metric"},type:"number"}]),0);
},"queries"));
test("changed visible account requires a new scope; redirect can wait for manual login",async()=>fixture(async f=>{
  f.scope=true;await f.service.call("connect",["settings"]);
  const first=f.service.call("operation",["enable",{value:true}]);void first.catch(()=>{});
  const a=await until(()=>f.approval,Boolean);await f.service.approve(a.id,["enable"]);await first;
  f.account="演示账号 B";await f.service.call("connect",["settings"]);
  const second=f.service.call("operation",["enable",{value:false}]);void second.catch(()=>{});
  const b=await until(()=>f.approval,v=>v?.id!==a.id&&Boolean(v));assert.equal(b.account,"演示账号 B");
  f.service.close();await assert.rejects(()=>second);
}));
test("an unconfirmed dispatched mutation interrupts the whole run, even if app catches it",async()=>fixture(async f=>{
  await f.service.call("connect",["settings"]);f.reply=false;
  const op=f.service.call("operation",["enable",{value:true}]);void op.catch(()=>{});
  const a=await until(()=>f.approval,Boolean);await f.service.approve(a.id,["enable"]);
  await assert.rejects(()=>op);assert.equal(f.unknown,1);await assert.rejects(()=>f.service.call("read",[{locator:{css:"#enabled"},type:"boolean"}]));
}));

test("same-URL login prompts wait for the user even without an account field; ready pages do not ask again",async()=>fixture(async f=>{
  delete f.detail.manifest.automation.browser.sites[0].account;
  parseAppBrowser(f.detail.manifest.automation.browser,f.detail.manifest.automation.capabilities);
  await f.service.call("connect",["products"]);
  assert.equal(f.loginQuestions.length,0);
  f.authRequired=true;
  await f.service.call("connect",["products"]);
  assert.equal(f.loginQuestions.length,1);
  assert.match(f.loginQuestions[0],/登录或人工验证/);
  await f.service.call("connect",["products"]);
  assert.equal(f.loginQuestions.length,1);
},"queries"));

test("authoring trials preserve actual read/extract values and selectors; polling duplicates do not fill evidence",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);
  const field={locator:{css:"#metric"},type:"number"};
  assert.equal(await f.service.call("read",[field]),0);
  assert.equal(await f.service.call("read",[field]),0);
  let reads=f.audit.filter(event=>event.message==="已记录网页字段证据");
  assert.equal(reads.length,1);assert.equal(reads[0].value.value,0);
  assert.equal(reads[0].value.args.field.locator.css,"#metric");
  f.readValue=null;assert.equal(await f.service.call("read",[field]),null);
  f.readValue=[{id:"000123",value:0}];
  assert.deepEqual(await f.service.call("extract",[{rows:{css:"#results tr"},fields:{id:{locator:{css:"td"}}}}]),[{id:"000123",value:0}]);
  reads=f.audit.filter(event=>event.message==="已记录网页字段证据");
  assert.deepEqual(reads.map(event=>event.value.method),["read","read","extract"]);
  assert.equal(reads[1].value.value,null);assert.equal(reads[2].value.siteId,"products");
},"queries",true));

test("installed runs do not collect private authoring read evidence by default",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);
  await f.service.call("read",[{locator:{css:"#metric"}}]);
  assert.equal(f.audit.some(event=>event.message==="已记录网页字段证据"),false);
},"queries"));

test("refresh preserves the run and revokes an unconsumed ticket before reconnecting",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);f.pumping=false;await f.service.detach(f.bridge);
  const read=f.service.call("read",[{locator:{css:"#value"}}]);void read.catch(()=>{});
  const oldBridge=randomUUID(),command=await until(()=>f.service.presence(oldBridge),Boolean);
  const old=f.service.claim(command.id,oldBridge),ticket=await f.service.arm(command.id,old.lease);
  await f.service.detach(oldBridge);
  await assert.rejects(()=>consumeAppBrowserTicket(ticket,old.command.payload));
  assert.equal(f.service.commandState(command.id),"pending");assert.equal(f.unknown,0);
  const newBridge=randomUUID();assert.equal(f.service.presence(newBridge).id,command.id);
  const current=f.service.claim(command.id,newBridge);
  await f.service.detach(oldBridge); // A late pagehide cannot detach the replacement.
  assert.throws(()=>f.service.complete(command.id,old.lease,{value:999}));
  const replacement=await f.service.arm(command.id,current.lease);
  await consumeAppBrowserTicket(replacement,current.command.payload);
  f.service.complete(command.id,current.lease,{value:0});
  assert.equal(await read,0);assert.equal(f.unknown,0);
  assert.ok(f.connections.includes(true));assert.equal(f.connections.at(-1),false);
},"queries"));

test("a modal suspends pending commands without ending the browser run",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);f.pumping=false;
  assert.equal(f.service.presence(f.bridge,false),null);
  const read=f.service.call("read",[{locator:{css:"#value"}}]);void read.catch(()=>{});
  await until(()=>f.connections.at(-1),value=>value===true);
  assert.equal(f.unknown,0);assert.equal(f.service.presence(f.bridge,false),null);
  const command=f.service.presence(f.bridge,true),claimed=f.service.claim(command.id,f.bridge);
  const ticket=await f.service.arm(command.id,claimed.lease);await consumeAppBrowserTicket(ticket,claimed.command.payload);
  f.service.complete(command.id,claimed.lease,{value:null});assert.equal(await read,null);
  assert.equal(f.connections.at(-1),false);
},"queries"));

test("a ticket already awaiting policy cannot borrow a replacement bridge's lease",async()=>fixture(async f=>{
  await f.service.call("connect",["products"]);f.pumping=false;await f.service.detach(f.bridge);
  const read=f.service.call("read",[{locator:{css:"#value"}}]);void read.catch(()=>{});
  const oldBridge=randomUUID(),command=await until(()=>f.service.presence(oldBridge),Boolean),old=f.service.claim(command.id,oldBridge);
  const oldTicket=await f.service.arm(command.id,old.lease),original=f.service.policy.bind(f.service);
  let release;const gate=new Promise(resolve=>{release=resolve;});let blocked=true;
  f.service.policy=async value=>{if(blocked){blocked=false;await gate;}return original(value);};
  const consuming=consumeAppBrowserTicket(oldTicket,old.command.payload);void consuming.catch(()=>{});
  try{
    await f.service.detach(oldBridge);
    const bridge=randomUUID();assert.equal(f.service.presence(bridge).id,command.id);
    const current=f.service.claim(command.id,bridge),ticket=await f.service.arm(command.id,current.lease);
    release();await assert.rejects(()=>consuming);
    await consumeAppBrowserTicket(ticket,current.command.payload);
    f.service.complete(command.id,current.lease,{value:0});assert.equal(await read,0);
  }finally{release();f.service.policy=original;}
},"queries"));

test("dispatched mutations survive detach without replay; a lost outcome stays interrupted",async()=>fixture(async f=>{
  await f.service.call("connect",["settings"]);
  const first=f.service.call("operation",["enable",{value:true}]);void first.catch(()=>{});
  const approval=await until(()=>f.approval,Boolean);await f.service.approve(approval.id,["enable"]);await first;
  f.pumping=false;await f.service.detach(f.bridge);
  const operation=f.service.call("operation",["enable",{value:false}]);void operation.catch(()=>{});
  const bridge=randomUUID(),command=await until(()=>f.service.presence(bridge),Boolean),claimed=f.service.claim(command.id,bridge);
  const ticket=await f.service.arm(command.id,claimed.lease);await consumeAppBrowserTicket(ticket,claimed.command.payload);
  assert.equal((await f.service.defer(command.id,claimed.lease,bridge)).deferred,false);
  await f.service.detach(bridge);
  assert.equal(f.service.commandState(command.id),"dispatched");
  assert.equal(f.service.presence(randomUUID()),null);assert.equal(f.unknown,0);
  // Advance only the fixture's deadline; no real network wait or mutation.
  f.service.commands.get(command.id).expiresAt=Date.now()-1;
  await assert.rejects(()=>operation);assert.equal(f.unknown,1);
}));


test("multi-megabyte session responses cross the HTTP receipt and reach the caller without replay or false evidence",async()=>fixture(async f=>{
  const { APP_BROWSER_POST_MAX_BYTES }=await jiti.import("../../features/automation/shared/automation-data-limits.ts");
  const { readAppRequest }=await jiti.import("../../features/automation/runtime/automation-app-server.ts");
  const site=f.detail.manifest.automation.browser.sites[0];
  site.operations.push({id:"large",label:"Read plans",description:"Large business response",effect:"query",kind:"request",request:{url:"https://inventory.example.test/plans",method:"GET"}});
  const rows=Array.from({length:100},(_,i)=>({itemId:String(i).padStart(8,"0"),detail:"计划详情".repeat(2500)}));
  const encoded=JSON.stringify({mode:"complete",result:{status:200,data:rows,dispatched:true}});
  assert.ok(Buffer.byteLength(encoded)>2*1024*1024);
  const receipt=JSON.parse((await readAppRequest(new Request("http://localhost/receipt",{method:"POST",body:encoded}),APP_BROWSER_POST_MAX_BYTES)).toString("utf8"));
  f.requestData=receipt.result.data;
  await f.service.call("connect",[site.id]);
  const response=await f.service.call("request",["large",{}]);
  assert.deepEqual(response.data,rows);assert.equal(f.requestCalls,1);
  assert(f.audit.some(entry=>entry.message.includes("证据超过保存范围")),"evidence omission is explicit but never fails business execution");
  await assert.rejects(()=>readAppRequest(new Request("http://localhost/receipt",{method:"POST",body:encoded}),512*1024),error=>error.status===413);
},"operations",true));

test("oversized native replies finish with the actual limit error instead of waiting or replaying",async()=>fixture(async f=>{
  const { APP_EXECUTION_VALUE_MAX_BYTES }=await jiti.import("../../features/automation/shared/automation-data-limits.ts");
  const site=f.detail.manifest.automation.browser.sites[0];
  site.operations.push({id:"oversized",label:"Read plans",description:"Oversize response",effect:"query",kind:"request",request:{url:"https://inventory.example.test/plans",method:"GET"}});
  await f.service.call("connect",[site.id]);f.requestData="x".repeat(APP_EXECUTION_VALUE_MAX_BYTES);
  await assert.rejects(()=>f.service.call("request",["oversized",{}]),/20 MiB/);
  assert.equal(f.requestCalls,1);assert.equal(f.unknown,0);
}));

test("binary downloads use the guarded native request and audit only metadata",async()=>fixture(async f=>{
  const site=f.detail.manifest.automation.browser.sites[0];
  site.operations.push({id:"zip",label:"ZIP",description:"Download report",effect:"query",kind:"request",request:{url:"https://download.example/reports/",method:"GET",response:"bytes",allowDynamicUrl:true}});
  await f.service.call("connect",[site.id]);
  const binary={encoding:"base64",base64:Buffer.from("private binary report").toString("base64"),bytes:21,contentType:"application/zip"};f.requestData=binary;
  await assert.rejects(f.service.call("request",["zip",{}]),/browser.download/);
  const result=await f.service.call("download",["zip",{url:"https://download.example/reports/a.zip?sign=private"}]);
  assert.equal(result.data.base64,binary.base64);assert.equal(f.requestCalls,1);
  assert.equal(f.audit.some(entry=>JSON.stringify(entry).includes(binary.base64)),false);
}));
