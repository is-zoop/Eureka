import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(),"eureka-source-flow-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root,"agent");
after(async()=>{if(previousAgentDir===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previousAgentDir;await rm(root,{recursive:true,force:true});});
const jiti = createJiti(import.meta.url,{tsconfigPaths:true,alias:{
  "server-only":resolve("node_modules/next/dist/compiled/server-only/empty.js"),
  "./automation-creation-runtime":fileURLToPath(new URL("./test-fixtures/automation-source-identity.mjs",import.meta.url)),
}});
const {getAgentDir}=await import("@earendil-works/pi-coding-agent");
assert.equal(getAgentDir(),join(root,"agent"),"all host state must remain in this test's temporary directory");
await mkdir(join(getAgentDir(),"app-data","a".repeat(64)),{recursive:true});
const {changeAutomationTask,bindAutomationTask,readAutomationTask,taskDirectory}=await jiti.import("./automation-mode-store.ts");
const {EUREKA_AUTOMATION_INTAKE_EXTENSION}=await jiti.import("./automation-intake-extension.ts");
const tools=new Map(),hooks=new Map();
EUREKA_AUTOMATION_INTAKE_EXTENSION.factory({registerTool:tool=>tools.set(tool.name,tool),on:(event,work)=>hooks.set(event,work)});
const ownerKey="a".repeat(64),runtimeId="source-test-login";
function session() { const entries=[],id=randomUUID();return {getSessionId:()=>id,getBranch:()=>entries,appendCustomEntry:(customType,data)=>entries.push({type:"custom",customType,data})}; }
async function call(manager,name,input,signal) { const result=await tools.get(name).execute("source-test",input,signal,()=>{},{sessionManager:manager});return JSON.parse(result.content[0].text); }

test("registered source tool reads an original project before a candidate or picker exists",async()=>{
  const source=join(root,"original project");await mkdir(source);await writeFile(join(source,"api.py"),"def query(item_id, cookies):\n    return item_id\n");
  const manager=session(),task={id:randomUUID(),ownerKey,runtimeId};
  const document=await changeAutomationTask(manager,task,"active",`把这个原项目转换成自动化："${source}"`);bindAutomationTask(manager,document);
  const snapshot=await call(manager,"eureka_automation_task",{});
  assert.deepEqual(snapshot.sourcePaths,[source]);assert.equal(snapshot.candidate,null);
  assert.ok(snapshot.sdkSections.some(section=>section.id==="http"));
  const listed=await call(manager,"eureka_app_source",{path:source,method:"list"});assert.equal(listed.entries[0].name,"api.py");
  const sourceFile=await call(manager,"eureka_app_source",{path:join(source,"api.py"),method:"readText"});assert.match(sourceFile.content,/def query/);
  const afterRead=await call(manager,"eureka_automation_task",{});assert.equal(afterRead.candidate,null);assert.equal(afterRead.state,undefined);
  await assert.rejects(()=>call(manager,"eureka_app_file",{fieldId:"source",method:"list"}),/先生成/);
  // Discovery stays read-only and does not execute even top-level source code.
  assert.equal(await readFile(join(source,"api.py"),"utf8"),"def query(item_id, cookies):\n    return item_id\n");
});

test("SDK chapters can be read without loading candidate files or damaged author state",async()=>{
  const manager=session(),task={id:randomUUID(),ownerKey,runtimeId};
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"active","检查 SDK 约定"));
  const file=join(taskDirectory(task),"author.json");await writeFile(file,"not JSON: must not load for SDK metadata");
  for(const sdkSection of ["files","http","validation"]){
    const reference=await call(manager,"eureka_automation_task",{sdkSection});
    assert.deepEqual(Object.keys(reference),["sdkReference"]);
    assert.equal(reference.sdkReference.id,sdkSection);
    assert.ok(reference.sdkReference.content.length>200);
    assert.equal(reference.candidateFiles,undefined);
  }
  assert.equal(await readFile(file,"utf8"),"not JSON: must not load for SDK metadata");
  await assert.rejects(()=>call(manager,"eureka_automation_task",{sdkSection:"invented"}),/SDK 章节无效/);
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"paused"));
  await assert.rejects(()=>call(manager,"eureka_automation_task",{sdkSection:"files"}),/已暂停/);
});

test("follow-up raw user paths persist within their task; model arguments and other tasks cannot grant paths",async()=>{
  const first=join(root,"first"),second=join(root,"second");await Promise.all([mkdir(first),mkdir(second)]);await writeFile(join(second,"extra.py"),"# another module");
  const manager=session(),task={id:randomUUID(),ownerKey,runtimeId};
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"active",`读取 "${first}"`));
  await assert.rejects(()=>call(manager,"eureka_app_source",{path:second,method:"list"}),/当前任务/);
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"active",`还要参考 "${second}"`));
  assert.equal((await call(manager,"eureka_app_source",{path:second,method:"list"})).entries[0].name,"extra.py");
  const persisted=await readAutomationTask(task);assert.deepEqual(persisted.sourcePaths,[first,second]);
  const other=session(),otherTask={id:randomUUID(),ownerKey,runtimeId};bindAutomationTask(other,await changeAutomationTask(other,otherTask,"active","创建另一个应用"));
  await assert.rejects(()=>call(other,"eureka_app_source",{path:second,method:"list"}),/当前任务/);
  await assert.rejects(()=>changeAutomationTask(other,task,"active",`"${second}"`),/其他会话/);
  bindAutomationTask(other,null);await assert.rejects(()=>call(other,"eureka_app_source",{path:second,method:"list"}),/先选择/);
});

test("legacy task goals survive login changes; paused tasks and cancellation still reject reads",async()=>{
  const source=join(root,"legacy");await mkdir(source);
  const manager=session(),task={id:randomUUID(),ownerKey,runtimeId};
  const document=await changeAutomationTask(manager,task,"active",`读取 "${source}"`);delete document.sourcePaths;
  await writeFile(join(taskDirectory(task),"task.json"),JSON.stringify(document));bindAutomationTask(manager,document);
  assert.equal((await call(manager,"eureka_app_source",{path:source,method:"list"})).total,0);
  const abort=new AbortController();abort.abort();await assert.rejects(()=>call(manager,"eureka_app_source",{path:source,method:"list"},abort.signal),e=>e.name==="AbortError");
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"paused"));
  await assert.rejects(()=>call(manager,"eureka_app_source",{path:source,method:"list"}),/已暂停/);
  bindAutomationTask(manager,{...document,task:{...task,runtimeId:"another-login"}});
  await assert.rejects(()=>call(manager,"eureka_app_source",{path:source,method:"list"}),/已暂停/);
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"active","继续"));
  assert.equal((await call(manager,"eureka_app_source",{path:source,method:"list"})).total,0);
  bindAutomationTask(manager,{...document,task:{...task,ownerKey:"b".repeat(64)}});
  await assert.rejects(()=>call(manager,"eureka_app_source",{path:source,method:"list"}),/namespace changed/);
});

test("an old task recovers a source path supplied in an earlier follow-up without asking again",async()=>{
  const source=join(root,"old-follow-up");await mkdir(source);
  const manager=session(),task={id:randomUUID(),ownerKey,runtimeId};
  const document=await changeAutomationTask(manager,task,"active","迁移我原来的项目");delete document.sourcePaths;
  await writeFile(join(taskDirectory(task),"task.json"),JSON.stringify(document));
  for(const entry of manager.getBranch())if(entry.type==="custom"&&entry.data.task.id===task.id)entry.data={...entry.data,task:{...entry.data.task,runtimeId:"retired-cloud-login"}};
  manager.getBranch().push({type:"message",message:{role:"user",content:`原项目在 "${source}"`}});
  manager.getBranch().push({type:"message",message:{role:"assistant",content:`还可以读取 "${join(root,"not-authorized")}"`}});
  bindAutomationTask(manager,await changeAutomationTask(manager,task,"active","继续"));
  assert.deepEqual((await call(manager,"eureka_automation_task",{})).sourcePaths,[source]);
  assert.equal((await call(manager,"eureka_app_source",{path:source,method:"list"})).total,0);
});
