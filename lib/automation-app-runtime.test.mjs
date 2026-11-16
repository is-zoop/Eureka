import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
import { fixtureZip } from "./haze-plugin-fixture.mjs";
const jiti = createJiti(import.meta.url);
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { fileAutomationExample } = await jiti.import("./automation-app-example.ts");
const { parseAutomationAppArchive, inspectAutomationFiles } = await jiti.import("./automation-app-package.ts");
const { appParameters } = await jiti.import("./automation-app-run.ts");
const { versionedAppStore } = await jiti.import("./automation-app-version-scope.ts");
const { withAutomationAppVersion } = await jiti.import("./automation-app-metadata.ts");
const { appWebServices, consumeAppBrowserTicket } = await jiti.import("./automation-app-browser-runtime.ts");
const { appHasLease, assertAppIdle } = await jiti.import("./automation-app-lease.ts");
const { startAppRun, stopAppRun, getAppRun, grantAppFile, appRunValue, appRunArtifact, listAppRuns, advanceAppRun, readAppConfiguration, answerAppRun } = await jiti.import("./automation-app-runtime.ts");

function checkpointFixture(files, script) {
 const plugin=JSON.parse(files.get('plugin.json')),automation=plugin.extensions['com.eureka'].automation;automation.checkpoints={schemaVersion:1};automation.capabilities.push('files.write');files.set('plugin.json',Buffer.from(JSON.stringify(plugin)));files.set('scripts/main.mjs',Buffer.from(script.replace('export default','const work =')+`;export default async ctx=>ctx.step('read',null,()=>work(ctx));`));
}
test("opt-in checkpoints resume explicitly into a new run and consume lineage only once",async()=>fixture(async({auth,install,values})=>{
 const first=randomUUID();await startAppRun(auth,install.id,install.revision,first,values,0);
 const failed=await until(()=>getAppRun(auth,install.id,first),r=>r.status==='failed');assert.equal(failed.checkpoint.key,'batch-1');assert.equal(failed.checkpoint.unsafe,false);
 await until(()=>appHasLease(auth.store.dataDirectory(install.id)),value=>value===false);
 const config=await readAppConfiguration(auth,install.id),second=randomUUID();
 await startAppRun(auth,install.id,install.revision,second,values,config.revision,undefined,{resumeFrom:first});
 const done=await until(()=>getAppRun(auth,install.id,second),r=>['completed','failed'].includes(r.status));assert.equal(done.status,'completed',done.error);assert.equal(done.resumedFrom,first);assert.deepEqual(await appRunValue(auth,install.id,second,done.resultRef),{next:2});
 assert.equal((await getAppRun(auth,install.id,first)).checkpoint.claimedBy,second);
 await until(()=>appHasLease(auth.store.dataDirectory(install.id)),value=>value===false);
 await assert.rejects(startAppRun(auth,install.id,install.revision,randomUUID(),values,(await readAppConfiguration(auth,install.id)).revision,undefined,{resumeFrom:first}),/检查点/);
},files=>checkpointFixture(files,`export default async ctx=>{const saved=await ctx.checkpoints.load();if(saved)return {next:saved.state.next};await ctx.checkpoints.save('batch-1',{next:2});throw new Error('fixture read failure');}`)));
test("writes after a checkpoint, changed input files and changed parameters block recovery",async()=>fixture(async({auth,install,values,source})=>{
 const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);const failed=await until(()=>getAppRun(auth,install.id,id),r=>r.status==='failed');assert.equal(failed.checkpoint.unsafe,true);
 await until(()=>appHasLease(auth.store.dataDirectory(install.id)),value=>value===false);
 await assert.rejects(startAppRun(auth,install.id,install.revision,randomUUID(),values,(await readAppConfiguration(auth,install.id)).revision,undefined,{resumeFrom:id}),/检查点/);
},files=>checkpointFixture(files,`export default async ctx=>{await ctx.checkpoints.save('batch-1',{next:2});await ctx.files.writeText(ctx.files.child(ctx.files.workspace,'output.txt'),'side effect');throw new Error('fixture stopped');}`)));
test("uncommitted writers cannot be checkpointed and direct filesystem writes are disabled only for opt-in apps",async()=>fixture(async({auth,install,values})=>{
 const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);const done=await until(()=>getAppRun(auth,install.id,id),r=>['completed','failed'].includes(r.status));assert.equal(done.status,'completed',done.error);assert.deepEqual(await appRunValue(auth,install.id,id,done.resultRef),{blocked:true,directBlocked:true});
},files=>checkpointFixture(files,`import fs from 'node:fs/promises';export default async ctx=>{let directBlocked=false;try{await fs.writeFile('bypass.txt','no')}catch(e){directBlocked=e.code==='ERR_ACCESS_DENIED'}const w=await ctx.files.createWriter(ctx.files.child(ctx.files.workspace,'staged.txt'));let blocked=false;try{await ctx.checkpoints.save('bad',{})}catch{blocked=true}await w.abort();return {blocked,directBlocked};}`)));
test("checkpoint apps cannot bypass mutation tracking through direct fetch or Node sockets",async()=>fixture(async({auth,install,values})=>{
 const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);const done=await until(()=>getAppRun(auth,install.id,id),r=>['completed','failed'].includes(r.status));assert.equal(done.status,'completed',done.error);assert.deepEqual(await appRunValue(auth,install.id,id,done.resultRef),{blocked:4});
},files=>checkpointFixture(files,`import {connect} from 'node:net';import {request} from 'node:http';import {connect as tlsConnect} from 'node:tls';export default async ctx=>{let blocked=0;for(const op of [()=>fetch('http://127.0.0.1:1'),()=>connect(1,'127.0.0.1'),()=>request('http://127.0.0.1:1'),()=>tlsConnect(1,'127.0.0.1')]){try{await op()}catch(e){if(e.message.includes('ctx.browser'))blocked++}}await ctx.checkpoints.save('safe',{});return {blocked};}`)));

test("checkpoint source metadata and parameters must still match before a new worker starts",async()=>fixture(async({auth,install,values,source})=>{
 const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);await until(()=>getAppRun(auth,install.id,id),r=>r.status==='failed');const config=await readAppConfiguration(auth,install.id);
 await until(()=>appHasLease(auth.store.dataDirectory(install.id)),value=>value===false);
 await assert.rejects(startAppRun(auth,install.id,install.revision,randomUUID(),{...values,delayMs:1},config.revision,undefined,{resumeFrom:id}),/检查点/);
 await writeFile(join(source,'report.txt'),'changed source data');await assert.rejects(startAppRun(auth,install.id,install.revision,randomUUID(),values,config.revision,undefined,{resumeFrom:id}),/检查点/);
},files=>checkpointFixture(files,`export default async ctx=>{await ctx.checkpoints.save('batch-1',{next:2});throw new Error('fixture read failure');}`)));

async function until(read, accept) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(40); }
  throw new Error("timed out waiting for worker");
}
async function fixture(work, modify) {
  const root = await mkdtemp(join(tmpdir(), "eureka-a03-")), source = join(root, "selected"), base = join(root, "agent");
  await mkdir(source); await writeFile(join(source, "empty.txt"), ""); await writeFile(join(source, "report.txt"), "source-data");
  const owner = "a".repeat(64), store = new AutomationAppStore(base, owner, () => {});
  let pkg = parseAutomationAppArchive(fileAutomationExample());
  if (modify) { modify(pkg.files); pkg = inspectAutomationFiles(pkg.files); }
  const install = await store.install(pkg, 0), auth = { ownerKey: owner, runtimeId: "test-login", store, assertIdentity: () => {} };
  const ref = await grantAppFile(auth, install.id, install.revision, "source", source, "read");
  try { await work({ root, source, store, install, auth, values: { source: ref, delayMs: 0 } }); }
  finally {
    // Only fixture-created paths are removed; no user folders are used.
    for (const record of await listAppRuns(auth, install.id)) if (["running", "waiting-user", "cancelling"].includes(record.status)) await stopAppRun(auth, install.id, record.id);
    await until(() => appHasLease(store.dataDirectory(install.id)), value => value === false);
    await rm(root, { recursive: true, force: true });
  }
}

test("historical selection executes the historical package without moving the latest default",async()=>fixture(async({auth,install,store,values})=>{
  const original=parseAutomationAppArchive((await store.export(install.id)).bytes);
  const updated=await store.install(withAutomationAppVersion(original,"1.0.1"),install.revision);
  const selected={...auth,store:versionedAppStore(store,install.id,"1.0.0")};
  const id=randomUUID();await startAppRun(selected,install.id,updated.revision,id,values,0);
  const done=await until(()=>getAppRun(selected,install.id,id),record=>["completed","failed"].includes(record.status));
  assert.equal(done.status,"completed",done.error);assert.equal(done.version,"1.0.0");assert.equal(done.digest,original.digest);
  assert.equal((await store.detail(install.id)).manifest.version,"1.0.1");
  await assert.rejects(startAppRun(auth,install.id,updated.revision,id,values,0),/另一项请求/);
}));

test("real worker downloads ZIP through the native bridge and extracts CSV into an authorized local directory",async()=>fixture(async({auth,install,root,values})=>{
  const output=join(root,"export");await mkdir(output);
  const destination=await grantAppFile(auth,install.id,install.revision,"output",output,"readwrite");
  const csv=Buffer.from([0xd6,0xd0,44,49,10]),zip=fixtureZip({"report.csv":csv},{prefix:""}),id=randomUUID(),bridge=randomUUID();
  let pumping=true,requests=0;
  const pump=(async()=>{while(pumping){
    const service=appWebServices(auth.ownerKey,install.id).find(service=>service.options.runId===id),pending=service?.presence(bridge);
    if(pending){const {lease,command}=service.claim(pending.id,bridge);const payload=JSON.parse(command.payload);
      if(["open","release"].includes(command.method))service.complete(command.id,lease,{ok:true});
      else{const ticket=await service.arm(command.id,lease);await consumeAppBrowserTicket(ticket,command.payload);
        if(command.method==="request"){requests++;assert.equal(payload.args.input.url,"https://download.example/reports/a.zip?sign=test");service.complete(command.id,lease,{status:200,data:{encoding:"base64",base64:zip.toString("base64"),bytes:zip.length,contentType:"application/zip"},dispatched:true});}
        else service.complete(command.id,lease,{origin:"http://127.0.0.1:8080",environment:"account:default:1",account:null});
      }
    }await delay(10);
  }})();
  try{await startAppRun(auth,install.id,install.revision,id,{...values,output:destination},0);
    const done=await until(()=>getAppRun(auth,install.id,id),record=>["completed","failed"].includes(record.status));
    assert.equal(done.status,"completed",done.error);assert.equal(requests,1);
    assert.deepEqual(await readFile(join(output,"source.zip")),zip);assert.deepEqual(await readFile(join(output,"report.csv")),csv);
    const result=await appRunValue(auth,install.id,id,done.resultRef);assert.equal(result.text,"中,1\n");assert.equal(result.files.length,1);
  }finally{pumping=false;await pump;}
},files=>{
  const plugin=JSON.parse(files.get("plugin.json")),automation=plugin.extensions["com.eureka"].automation;
  automation.capabilities=["files.read","files.write","browser.read"];
  automation.browser={schemaVersion:1,sites:[{id:"report",label:"Report",startUrl:"http://127.0.0.1:8080/automation-app-demo.html",paths:["/automation-app-demo.html"],operations:[{id:"zip",label:"Download ZIP",description:"Read report",kind:"request",effect:"query",request:{url:"https://download.example/reports/",method:"GET",response:"bytes",allowDynamicUrl:true}}]}]};
  files.set("plugin.json",Buffer.from(JSON.stringify(plugin)));
  const ui=JSON.parse(files.get("ui.json"));ui.fields.push({id:"output",label:"Output",type:"directory",required:true});files.set("ui.json",Buffer.from(JSON.stringify(ui)));
  files.set("workflow.json",Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:"download",label:"Download and extract",kind:"browser"}],edges:[]})));
  files.set("scripts/main.mjs",Buffer.from('export default async ctx=>ctx.step("download",null,async()=>{await ctx.browser.connect("report");const file=await ctx.browser.download("zip",{url:"https://download.example/reports/a.zip?sign=test"},ctx.files.child(ctx.params.output,"source.zip"));const extracted=await ctx.files.extractZip(file.ref,ctx.params.output);return {files:extracted.files,text:await ctx.files.readText(extracted.files[0].ref,"gb18030")};});'));
}));

test("runtime SDK supports independent signing with built-in crypto and private parameters",async()=>fixture(async({auth,install,values})=>{
  const runId=randomUUID(),signingSecret="fixture-only-business-secret";
  await startAppRun(auth,install.id,install.revision,runId,{...values,signingSecret},0);
  const run=await until(()=>getAppRun(auth,install.id,runId),run=>["completed","failed"].includes(run.status));
  assert.equal(run.status,"completed",run.error);
  assert.deepEqual(await appRunValue(auth,install.id,runId,run.resultRef),{signature:createHash("md5").update(signingSecret+"|body").digest("hex")});
},files=>{
  const ui=JSON.parse(files.get("ui.json"));ui.fields.push({id:"signingSecret",label:"业务签名配置",type:"text",required:true});ui.results.columns=[{key:"signature",label:"签名",type:"text"}];
  files.set("ui.json",Buffer.from(JSON.stringify(ui)));
  files.set("workflow.json",Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:"sign",label:"业务签名",kind:"script"}],edges:[]})));
  files.set("scripts/main.mjs",Buffer.from('import {createHash} from "node:crypto"; export default async ctx=>ctx.step("sign",{algorithm:"md5"},async()=>({signature:createHash("md5").update(ctx.params.signingSecret+"|body").digest("hex")}));'));
}));

test("real worker adds an authorized binary file to the run download list without text encoding",async()=>fixture(async({auth,install,values,source})=>{
 const bytes=Buffer.from([0,0xff,0x81,0x2c,0x31]);await writeFile(join(source,'report.txt'),bytes);
 const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);const run=await until(()=>getAppRun(auth,install.id,id),r=>['completed','failed'].includes(r.status));assert.equal(run.status,'completed',run.error);assert.equal(run.artifacts[0].name,'报表.zip');assert.equal(run.artifacts[0].mediaType,'application/zip');assert.deepEqual((await appRunArtifact(auth,install.id,id,run.artifacts[0].id)).bytes,bytes);
},files=>files.set('scripts/main.mjs',Buffer.from(`export default async ctx=>ctx.step('read',null,async()=>ctx.artifacts.fromFile('报表.zip',ctx.files.child(ctx.params.source,'report.txt'),'application/zip'));`))));

test("runtime multiple-choice answers persist and resume the same worker as JSON",async()=>fixture(async({auth,install,values})=>{
  const runId=randomUUID();await startAppRun(auth,install.id,install.revision,runId,values,0);
  const waiting=await until(()=>getAppRun(auth,install.id,runId),run=>["waiting-user","failed"].includes(run.status));
  assert.equal(waiting.status,"waiting-user",waiting.error);
  await answerAppRun(auth,install.id,runId,waiting.question.id,[{questionId:waiting.question.questions[0].id,optionIds:["1","2"]}]);
  const run=await until(()=>getAppRun(auth,install.id,runId),run=>["completed","failed"].includes(run.status));
  assert.equal(run.status,"completed",run.error);
  const result=await appRunValue(auth,install.id,runId,run.resultRef);
  assert.deepEqual(result.optionIds,["1","2"]);assert.equal(Object.hasOwn(result,"optionId"),false);
  assert.equal(run.events.filter(event=>event.kind==="question"&&event.status==="answered").length,1);
},files=>{
  const manifest=JSON.parse(files.get("plugin.json"));manifest.extensions["com.eureka"].automation.capabilities.push("clarification");files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  files.set("workflow.json",Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:"ask",label:"询问",kind:"wait-user"}],edges:[]})));
  files.set("scripts/main.mjs",Buffer.from('export default async ctx=>ctx.step("ask",null,async()=>{const [answer]=await ctx.ask([{title:"选项",question:"选择需要处理的项目",selection:"multiple",options:[{label:"A"},{label:"B"}]}]);return answer;});'));
}));
test("real worker exposes contract metadata and processes XLSX/CSV and chunks through granted host RPC",async()=>fixture(async({auth,install,values})=>{
  const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);
  const run=await until(()=>getAppRun(auth,install.id,id),record=>['completed','failed','interrupted'].includes(record.status));
  assert.equal(run.status,'completed',run.error);const result=await appRunValue(auth,install.id,id,run.resultRef);
  assert.equal(result.version,JSON.parse(await readFile(new URL('./automation-sdk-contract.json',import.meta.url),'utf8')).sdkVersion);assert.equal(result.rows[1].values[0],'000012345678901234567890');assert.equal(result.bytes,4);assert.equal(result.cells[1].values[1],25);
},files=>{
  const manifest=JSON.parse(files.get('plugin.json'));manifest.extensions['com.eureka'].automation.capabilities=['files.read','files.write'];files.set('plugin.json',Buffer.from(JSON.stringify(manifest)));
  files.set('workflow.json',Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:'export',label:'Tables',kind:'script'}],edges:[]})));
  files.set('scripts/main.mjs',Buffer.from(`export default async ctx=>ctx.step('export',null,async()=>{
    const file=name=>ctx.files.child(ctx.files.workspace,name);
    const csv=await ctx.tables.createWriter(file('report.csv'),{format:'csv',columns:[{key:'id',type:'text'},{key:'cost',type:'number'}]});
    await ctx.tables.appendRows(csv,[{id:'000012345678901234567890',cost:12.5}]);await ctx.tables.commitWriter(csv);
    const reader=await ctx.tables.openReader(file('report.csv'),{format:'csv'});const batch=await ctx.tables.readRows(reader,500);
    const xlsx=await ctx.tables.createWriter(file('report.xlsx'),{format:'xlsx',sheets:[{name:'Report',columns:[{key:'id',type:'text'},{key:'cost',type:'number'}]}]});await ctx.tables.appendRows(xlsx,[['000012345678901234567890',25]],'Report');await ctx.tables.commitWriter(xlsx);
    const excel=await ctx.tables.openReader(file('report.xlsx'),{format:'xlsx'});const cells=await ctx.tables.readRows(excel,500);
    const writer=await ctx.files.createWriter(file('bytes.bin'));await writer.write(Buffer.from([1,2,3,4]));await writer.commit();const chunk=await ctx.files.readChunk(file('bytes.bin'),{offset:0,length:4});
    return{version:ctx.sdk.sdkVersion,rows:batch.rows,cells:cells.rows,bytes:chunk.bytes.length};
  });`));
}));
test("real worker reports actual nodes and artifacts; duplicate start does not execute twice", async () => fixture(async ({ auth, install, store, source, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  const record = await until(() => getAppRun(auth, install.id, id), value => value.status === "completed" || value.status === "failed");
  assert.equal(record.status, "completed", record.error);
  assert.equal(record.events.filter(e => e.kind === "node" && e.nodeId === "inspect" && e.status === "completed").length, 2);
  assert(record.events.every((event, i) => event.seq === i + 1));
  const result = await appRunValue(auth, install.id, id, record.resultRef);
  assert.equal(result.find(row => row.name === "empty.txt").size, 0);
  const artifact = await appRunArtifact(auth, install.id, id, record.artifacts[0].id);
  assert(artifact.bytes.toString("utf8").startsWith("\uFEFF"));
  assert.equal(await readFile(join(source, "report.txt"), "utf8"), "source-data");
  const retry = await startAppRun(auth, install.id, install.revision, id, values, 0);
  assert.equal(retry.id, id); assert.equal(retry.artifacts.length, 1);
  const exported = parseAutomationAppArchive((await store.export(install.id)).bytes);
  assert.equal(exported.files.has("config.json"), false); assert(![...exported.files.keys()].some(name => name.includes("logs/")));
}));
test("conversation steps wait for tool authorization, preserve script data and do not save temporary config", async () => fixture(async ({ auth, install, values }) => {
  const id = randomUUID(), options = { conversationSteps: true, persistConfiguration: false };
  await startAppRun(auth, install.id, install.revision, id, values, 0, "run", options);
  let record = await until(() => getAppRun(auth, install.id, id), value => value.stepControl?.pending.length);
  assert.equal(record.events.filter(event => event.kind === "node").length, 0);
  const first = record.stepControl.pending[0];
  assert.equal(first.nodeId, "read");
  assert.equal((await appRunValue(auth, install.id, id, first.inputRef)).source, values.source.label);
  await advanceAppRun(auth, install.id, id, first.token);
  await advanceAppRun(auth, install.id, id, first.token);
  record = await until(() => getAppRun(auth, install.id, id), value => value.stepControl?.pending.length && !value.stepControl.current);
  assert.equal(record.events.filter(event => event.kind === "node" && event.nodeId === "read" && event.status === "completed").length, 1);
  assert.equal(record.events.some(event => event.kind === "node" && event.nodeId === "inspect"), false);
  for (let count = 0; count < 10 && !["completed", "failed"].includes(record.status); count++) {
    if (record.stepControl?.pending.length) await advanceAppRun(auth, install.id, id, record.stepControl.pending[0].token);
    record = await until(() => getAppRun(auth, install.id, id), value => ["completed", "failed"].includes(value.status) || value.stepControl?.pending.length && !value.stepControl.current);
  }
  assert.equal(record.status, "completed", record.error);
  assert.equal((await appRunValue(auth, install.id, id, record.resultRef)).length, 2);
  assert.equal(record.artifacts.length, 1);
  assert.equal((await readAppConfiguration(auth, install.id)).revision, 0);
}));
test("separate conversations can run the same app with independent workspaces and leases", async () => fixture(async ({ auth, install, store, values }) => {
  const ids=[randomUUID(),randomUUID()],options={conversationSteps:true,persistConfiguration:false,isolatedWorkspace:true};
  for(let n=0;n<ids.length;n++) {
    await startAppRun(auth,install.id,install.revision,ids[n],{...values,delayMs:n+1},0,"run",options);
    await until(()=>getAppRun(auth,install.id,ids[n]),record=>record.stepControl?.pending.length);
  }
  const data=store.dataDirectory(install.id);
  for(let n=0;n<ids.length;n++) {
    const pending=await getAppRun(auth,install.id,ids[n]);
    assert.equal(pending.isolation,"run");
    await advanceAppRun(auth,install.id,ids[n],pending.stepControl.pending[0].token);
    const done=await until(()=>getAppRun(auth,install.id,ids[n]),record=>["completed","failed"].includes(record.status));
    assert.equal(done.status,"completed",done.error);
    assert.equal(await appRunValue(auth,install.id,ids[n],done.resultRef),String(n+1));
    assert.equal(await readFile(join(data,"logs","runs",ids[n],"workspace","marker.txt"),"utf8"),String(n+1));
    await until(()=>appHasLease(data,ids[n]),held=>!held);
    if(n===0){assert.equal(await appHasLease(data),true);await assert.rejects(()=>assertAppIdle(data),/运行/);}
  }
  assert.equal((await readAppConfiguration(auth,install.id)).revision,0);
},files=>{
  const manifest=JSON.parse(files.get("plugin.json").toString("utf8"));
  manifest.extensions["com.eureka"].automation.capabilities.push("files.write");
  files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  files.set("scripts/main.mjs",Buffer.from('export default async ctx => ctx.step("read", null, async () => { const file=ctx.files.child(ctx.files.workspace,"marker.txt"); await ctx.files.writeText(file,String(ctx.params.delayMs)); return ctx.files.readText(file); });'));
}));

test("cancellation ends a non-responsive worker and prevents removal until it has stopped", async () => fixture(async ({ auth, install, store, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  await until(() => getAppRun(auth, install.id, id), record => record.events.some(e => e.kind === "node" && e.status === "running"));
  await assert.rejects(store.uninstall(install.id, install.revision), /运行/);
  await assert.rejects(store.uninstall(install.id, install.revision, undefined, true), /运行/);
  await stopAppRun(auth, install.id, id);
  const stopped = await until(() => getAppRun(auth, install.id, id), record => record.status === "cancelled");
  assert.equal(stopped.resultRef, undefined);
  assert(!stopped.events.some(e => e.kind === "node" && e.status === "completed"));
}, files => files.set("scripts/main.mjs", Buffer.from('export default async ctx => ctx.step("read", null, async () => { while (true) {} });'))));
test("worker cannot directly write a read-only selection through Node fs", async () => fixture(async ({ auth, install, source, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  const stopped = await until(() => getAppRun(auth, install.id, id), record => record.status === "failed");
  assert.match(stopped.error, /restricted|denied|permission/i);
  await assert.rejects(readFile(join(source, "forbidden.txt")), { code: "ENOENT" });
}, files => files.set("scripts/main.mjs", Buffer.from('import {writeFile} from "node:fs/promises"; export default async ctx => ctx.step("read", null, () => writeFile(ctx.params.source.label + "/forbidden.txt", "bad"));'))));
test("parameter types retain long text IDs, zero, false, null, percentages and JSON values", () => {
  const fields = [{ id: "id", label: "编号", type: "text", required: true }, { id: "zero", label: "零", type: "number", required: true }, { id: "flag", label: "开关", type: "boolean", required: true }, { id: "empty", label: "空值", type: "text" }, { id: "rate", label: "比例", type: "percentage" }, { id: "rows", label: "列表", type: "list" }, { id: "date", label: "日期", type: "date" }];
  const ui = { fields }, values = { id: "999999999999999999999", zero: 0, flag: false, empty: null, rate: 12.5, rows: [{ name: "A", value: 0 }], date: "2026-10-31" };
  assert.deepEqual(appParameters(ui, values, true), values);
  assert.throws(() => appParameters(ui, { ...values, date: "2026-02-30" }, true));
  assert.throws(() => appParameters(ui, { ...values, zero: NaN }, true));
});


test("real worker persists and reads multi-megabyte step and final results without the old 1 MiB limit",async()=>fixture(async({auth,install,values})=>{
  const id=randomUUID();await startAppRun(auth,install.id,install.revision,id,values,0);
  const run=await until(()=>getAppRun(auth,install.id,id),r=>["completed","failed"].includes(r.status));
  assert.equal(run.status,"completed",run.error);
  const value=await appRunValue(auth,install.id,id,run.resultRef);
  assert.equal(value.length,100);assert.equal(value[0].itemId,"00000000");assert.equal(value[99].itemId,"00000099");
  assert.equal(value[0].detail,"计划详情".repeat(2500));
  assert.ok(Buffer.byteLength(JSON.stringify(value))>2*1024*1024);
  const step=run.events.find(e=>e.kind==="node"&&e.status==="completed");
  assert.deepEqual(await appRunValue(auth,install.id,id,step.outputRef),value);
},files=>{
  const ui=JSON.parse(files.get("ui.json"));ui.results.columns=[{key:"itemId",label:"ID",type:"text"},{key:"detail",label:"详情",type:"text"}];files.set("ui.json",Buffer.from(JSON.stringify(ui)));
  files.set("workflow.json",Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:"query",label:"大响应",kind:"script"}],edges:[]})));
  files.set("scripts/main.mjs",Buffer.from('export default async ctx=>ctx.step("query",null,async()=>Array.from({length:100},(_,i)=>({itemId:String(i).padStart(8,"0"),detail:"计划详情".repeat(2500)})));'));
}));
