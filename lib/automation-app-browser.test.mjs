// Test sources only. Run manually; no real browser, login or business website.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {parseAppBrowser,parseAppLocator,parseAppPageField,appSiteAllows}=await jiti.import("./automation-app-browser.ts");
const {browserAutomationExample}=await jiti.import("./automation-app-browser-example.ts");
const {parseAutomationAppArchive}=await jiti.import("./automation-app-package.ts");
const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
const {ApplicationBrowserRuntime,consumeAppBrowserTicket}=await jiti.import("./automation-app-browser-runtime.ts");

test("arbitrary page fields and semantic locators are typed; malformed declarations fail closed",()=>{
  for(const type of ["text","number","date","percentage","boolean","object","list"])assert.equal(parseAppPageField({locator:{css:".value"},type}).type,type);
  assert.deepEqual(parseAppLocator({role:"button",name:"查询",within:{testId:"toolbar"}}),{role:"button",name:"查询",within:{testId:"toolbar"}});
  for(const v of [{source:["text"]},{type:["number"]},{source:"attribute",attribute:"data-token"},{source:"attribute",attribute:"value"}])assert.throws(()=>parseAppPageField(v));
  assert.throws(()=>parseAppLocator({css:"button",text:"确认"}));
  assert.throws(()=>parseAppLocator({css:"button",nth:-1}));
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
async function until(read,match){for(let i=0;i<100;i++){const value=await read();if(match(value))return value;await delay(10);}throw new Error("fixture wait timed out");}
async function fixture(work,kind="operations",captureReads=false){
  const root=await mkdtemp(join(tmpdir(),"eureka-a04-")),owner="a".repeat(64),store=new AutomationAppStore(root,owner,()=>{});
  const pkg=parseAutomationAppArchive(browserAutomationExample(kind)),installed=await store.install(pkg,0),detail=await store.detail(installed.id);
  let live=true,approval=null,unknown=0,account="演示账号 A",scope=false,authRequired=false;
  const loginQuestions=[],audit=[],connections=[];let readValue=0;
  const service=new ApplicationBrowserRuntime({ownerKey:owner,runtimeId:"test-login",runId:randomUUID(),detail,store,captureReads,
    check:()=>{if(!live)throw new Error("stopped");},connection:async waiting=>{connections.push(waiting);},askLogin:async message=>{loginQuestions.push(message);account="演示账号 A";scope=false;authRequired=false;},showApproval:async a=>{approval=a;},saveSession:async()=>{},audit:async(message,value)=>{audit.push({message,value});},unknownOutcome:async()=>{unknown++;live=false;}});
  const bridge=randomUUID();let stopPump=false,reply=true,repeat=false,lastTicket="",pumping=true;
  const pump=(async()=>{while(!stopPump){try{
    const pending=pumping?service.presence(bridge):null;if(pending){const {lease,command}=service.claim(pending.id,bridge),request=JSON.parse(command.payload);
      if(["open","release"].includes(command.method))service.complete(command.id,lease,{ok:true});
      else {const token=await service.arm(command.id,lease);lastTicket=token;await consumeAppBrowserTicket(token,command.payload);
        if(repeat)await assert.rejects(()=>consumeAppBrowserTicket(token,command.payload));
        const result=command.method==="probe"?{origin:scope?"https://login.example.test":"http://127.0.0.1:8080",environment:"account:default:1",account:scope||!request.site.account?null:account,outOfScope:scope,authRequired}:command.method==="operation"?{dispatched:true,verified:reply,before:false,after:request.args.input.value}:{value:readValue};
        service.complete(command.id,lease,result);
      }
    }
  }catch(e){if(live&&!stopPump&&!/网页运行已停止|stopped/.test(e.message))throw e;}await delay(5);}})();
  try{await work({service,store,detail,loginQuestions,audit,connections,bridge,set pumping(value){pumping=value;},get approval(){return approval;},get unknown(){return unknown;},get lastTicket(){return lastTicket;},set account(v){account=v;},set scope(v){scope=v;},set authRequired(v){authRequired=v;},set reply(v){reply=v;},set repeat(v){repeat=v;},set readValue(v){readValue=v;}});}
  finally{stopPump=true;service.close();await pump;await rm(root,{recursive:true,force:true});}
}
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
