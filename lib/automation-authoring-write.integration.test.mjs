import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Exercise the registered authoring tools with real temporary stores. No login,
// website, provider request, published installation or business operation is used.
const root = await mkdtemp(join(tmpdir(), "eureka-author-write-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: {
  "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js"),
  "./automation-creation-runtime": fileURLToPath(new URL("./test-fixtures/automation-source-identity.mjs", import.meta.url)),
} });
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
assert.equal(getAgentDir(), join(root, "agent"));
await mkdir(join(getAgentDir(),"app-data","a".repeat(64)),{recursive:true});
const { changeAutomationTask, bindAutomationTask } = await jiti.import("./automation-mode-store.ts");
const { authorAccess, saveAuthor, authorManualTest, authorSavedReference } = await jiti.import("./automation-authoring.ts");
const { getAppRun, appRunValue, stopAppRun } = await jiti.import("./automation-app-runtime.ts");
const { appHasLease } = await jiti.import("./automation-app-lease.ts");
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { parseAutomationAppArchive, inspectAutomationFiles } = await jiti.import("./automation-app-package.ts");
const { multiActionAutomationFixture } = await jiti.import("./test-fixtures/automation-multi-actions.ts");
const { EUREKA_AUTOMATION_INTAKE_EXTENSION } = await jiti.import("./automation-intake-extension.ts");
const tools = new Map(), hooks = new Map();
EUREKA_AUTOMATION_INTAKE_EXTENSION.factory({ registerTool: tool => tools.set(tool.name, tool), on: (name, hook) => hooks.set(name, hook) });

async function fixture(updateFiles = () => {}, baseApp) {
  const entries = [], sessionId = randomUUID();
  const manager = { getSessionId: () => sessionId, getBranch: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
  const task = { id: randomUUID(), ownerKey: "a".repeat(64), runtimeId: "source-test-login", ...(baseApp?{baseApp}:{}) };
  bindAutomationTask(manager, await changeAutomationTask(manager, task, "active", "创建文本处理工具箱"));
  const files = Object.fromEntries([...parseAutomationAppArchive(multiActionAutomationFixture()).files]
    .map(([name, bytes]) => [name, bytes.toString("utf8")]));
  const manifest = JSON.parse(files["plugin.json"]);
  manifest.extensions["com.eureka"].automation.id = task.baseApp?.id??task.id;
  files["plugin.json"] = JSON.stringify(manifest);
  updateFiles(files);
  const pkg = inspectAutomationFiles(new Map(Object.entries(files).map(([name, text]) => [name, Buffer.from(text)])));
  const access = await authorAccess(task), stateFile = join(access.directory, "author.json");
  const input = { files, scope: ["统计文本、转换大写、逐行去重"], limitations: ["仅处理文本"], checks: [] };
  const call = async (name, args = {}) => {
    const result = await tools.get(name).execute("write-test", args, undefined, () => {}, { sessionManager: manager });
    return JSON.parse(result.content[0].text);
  };
  return { task, manager, files, pkg, access, stateFile, input, call, read: async () => JSON.parse(await readFile(stateFile, "utf8")) };
}

test("a first multi-function write persists a JSON-safe candidate and can be read again", async () => {
  const f = await fixture(), { checks, ...manualInput } = f.input, written = await f.call("eureka_app_write", manualInput);
  assert.deepEqual(checks, []);
  assert.equal(written.generated, true);
  assert.equal(written.saved, false);
  const state = await f.read();
  assert.deepEqual(state.candidate.actionTrials.count, { checks: [] });
  assert.equal(state.pendingWrite, undefined);
  const snapshot = await f.call("eureka_automation_task");
  assert.equal(snapshot.candidate.digest, written.digest);
  assert.deepEqual(snapshot.files.map(file=>file.path).sort(),Object.keys(f.files).sort());
  assert.equal(snapshot.candidateFiles,undefined);assert.equal(snapshot.state,undefined);assert.equal(snapshot.sdk,undefined);
  assert.equal(snapshot.testing, "manual-only");
  assert.equal(await f.access.host.find(f.task.id), null, "draft is not published");
});

test("documented classifier templates pass the registered write tool and save without running models", async () => {
  const { automationSdkSection } = await jiti.import("./automation-sdk-reference.ts");
  const examples = [...automationSdkSection("ai").content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
  assert.equal(examples.length, 3);
  for (const example of examples) {
    const [ruleId, rule] = Object.entries(example.rules)[0];
    const f = await fixture(files => {
      const manifest = JSON.parse(files["plugin.json"]), declaration = manifest.extensions["com.eureka"].automation;
      declaration.capabilities = ["ai"]; declaration.actions[0].capabilities = ["ai"];
      declaration.files.push("ai/rules.json");
      files["plugin.json"] = JSON.stringify(manifest);
      files["ai/rules.json"] = JSON.stringify(example);
      files["workflow.json"] = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "judge", label: "Classify", kind: "ai" }], edges: [] });
      files["scripts/count.mjs"] = `export default async ctx => ctx.step("judge", { text: ctx.params.text }, async () => [{ value: await ctx.ai(${JSON.stringify(ruleId)}, { text: ctx.params.text }) }]);`;
      const ui = JSON.parse(files["ui.json"]); ui.results.columns = [{ key: "value", label: "Result", type: rule.output.type }]; files["ui.json"] = JSON.stringify(ui);
    });
    const chapter = await f.call("eureka_automation_task", { sdkSection: "ai" });
    assert.match(chapter.sdkReference.content, /classifier\.type/);
    if (rule.classifier.type === "bool") {
      const flat = { ...rule, ...rule.classifier }; delete flat.classifier;
      await assert.rejects(f.call("eureka_app_write", { files: { ...f.files, "ai/rules.json": JSON.stringify({ schemaVersion: 1, rules: { [ruleId]: flat } }) } }), /classifier/);
      assert.equal((await f.call("eureka_automation_task")).candidate, null);
    }
    const written = await f.call("eureka_app_write", { files: f.files });
    assert.equal(written.generated, true); assert.equal(written.saved, false);
    const saved = await saveAuthor(f.task, written.digest);
    assert.equal(saved.id, f.task.id);
    assert.ok(await f.access.host.find(f.task.id));
    assert.equal((await f.read()).candidate.runId, undefined, "generating and saving must not run the classifier or require an account");
  }
});

test("final state validation rejects oversized metadata before installing a version", async () => {
  const f = await fixture();
  const evidence = Array.from({ length: 21 }, (_, i) => ({ id: String(i), method: "read", at: "fixture", value: "x".repeat(195000) }));
  await f.access.host.privateJson(f.stateFile, { schemaVersion: 1, evidence });
  const checks = Array.from({ length: 4 }, () => ({ source: "result", expected: "y".repeat(30000) }));
  await assert.rejects(() => f.call("eureka_app_write", { ...f.input, checks }), /超过/);
  assert.equal(await f.access.store.find(f.task.id), null);
  assert.equal((await f.read()).pendingWrite, undefined);
});

test("a failed final state rename recovers the committed package and exact private checks without rewriting code", async () => {
  const f = await fixture(), checks = [{ source: "result", expected: [{ characters: 3, lines: 1 }] }];
  const original = AutomationAppStore.prototype.privateJson;
  let injected = false;
  AutomationAppStore.prototype.privateJson = async function (path, value) {
    if (path === f.stateFile && value.candidate && !value.pendingWrite && !injected) {
      injected = true;
      throw Object.assign(new Error("EPERM fixture rename"), { code: "EPERM" });
    }
    return original.call(this, path, value);
  };
  try {
    await assert.rejects(() => f.call("eureka_app_write", { ...f.input, checks }), /代码包已生成.*eureka_automation_task/);
  } finally { AutomationAppStore.prototype.privateJson = original; }
  assert.equal(injected, true);
  const before = await f.read(), installed = await f.access.store.find(f.task.id);
  assert.equal(before.candidate, undefined);
  assert.equal(before.pendingWrite.candidate.digest, f.pkg.digest);
  const snapshot = await f.call("eureka_automation_task");
  assert.equal(snapshot.candidate.revision, installed.revision);
  assert.deepEqual(snapshot.candidate.scope, f.input.scope);
  assert.deepEqual((await f.read()).candidate.checks, checks);
  assert.equal((await f.read()).candidate.validation, undefined);
  assert.deepEqual(snapshot.files.map(file=>file.path).sort(),Object.keys(f.files).sort());
  assert.equal(snapshot.candidateFiles,undefined);assert.equal(snapshot.state,undefined);assert.equal(snapshot.sdk,undefined);
  assert.equal((await f.read()).pendingWrite, undefined);
  assert.equal((await f.access.store.find(f.task.id)).revision, installed.revision, "recovery does not reinstall");
  const retry = await f.call("eureka_app_write", { ...f.input, checks, baseDigest:snapshot.digest });
  assert.equal(retry.digest, f.pkg.digest, "the identical version remains retryable");
});

test("an uncommitted write intent never becomes a candidate or a successful trial", async () => {
  const f = await fixture();
  await f.access.host.privateJson(f.stateFile, { schemaVersion: 1, evidence: [], pendingWrite: {
    version: "1.0.0", candidate: { id: f.task.id, digest: f.pkg.digest, revision: 0, checks: [], scope: [], limitations: [], actionId: "count", actionTrials: {} },
  } });
  const snapshot = await f.call("eureka_automation_task");
  assert.equal(snapshot.candidate, null);
  assert.equal(snapshot.candidateFiles, undefined);
  assert.equal((await f.read()).pendingWrite.candidate.digest, f.pkg.digest);
  assert.equal(await f.access.store.find(f.task.id), null);
});

test("legacy orphan packages recover for both missing and stale placeholder candidates without fabricating validation and allow manual save", async () => {
  for (const placeholder of [false, true]) {
    const f = await fixture();
    const state = { schemaVersion: 1, evidence: [{ id: "kept", method: "read", at: "fixture", value: "private evidence" }] };
    if (placeholder) state.candidate = { id: f.task.id, digest: "0".repeat(64), revision: 1, checks: [{ source: "result", expected: [] }], scope: ["占位草稿"], limitations: [], actionId: "placeholder" };
    await f.access.host.privateJson(f.stateFile, state);
    const installed = await f.access.store.install(f.pkg, 0);
    const snapshot = await f.call("eureka_automation_task");
    assert.equal(snapshot.candidate.digest, f.pkg.digest);
    assert.equal(snapshot.candidate.revision, installed.revision);
    assert.deepEqual((await f.read()).candidate.checks, []);
    assert.deepEqual((await f.read()).evidence, state.evidence);
    assert.equal((await f.read()).candidate.runId, undefined);
    assert.equal((await f.read()).candidate.validation, undefined);
    assert.equal((await f.read()).candidate.saved, undefined);
    assert.equal(snapshot.testing, "manual-only");
    assert.deepEqual(snapshot.files.map(file=>file.path).sort(),Object.keys(f.files).sort());
  assert.equal(snapshot.candidateFiles,undefined);assert.equal(snapshot.state,undefined);assert.equal(snapshot.sdk,undefined);
    const saved=await saveAuthor(f.task, f.pkg.digest);
    assert.equal(saved.id,f.task.id);
    assert.equal((await f.read()).candidate.validation,undefined);
    assert.ok(await f.access.host.find(f.task.id));
  }
});


async function until(read, accept) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,30));}
  throw new Error("fixture did not settle");
}

test("save accepts absent, failed and partial validation without executing or fabricating a pass",async()=>{
  for(const validation of [undefined,{status:"failed",checks:[]},{status:"passed",checks:[]}]){
    const f=await fixture();await f.call("eureka_app_write",f.input);
    const state=await f.read();
    if(validation)state.candidate.validation={...validation,digest:f.pkg.digest,runId:randomUUID(),at:new Date().toISOString()};
    await f.access.host.privateJson(f.stateFile,state);
    const saved=await saveAuthor(f.task,f.pkg.digest,"人工保存应用");
    assert.equal(saved.displayName,"人工保存应用");
    assert.equal((await f.access.host.detail(saved.id)).manifest.displayName,"人工保存应用");
    assert.deepEqual((await f.read()).candidate.validation,state.candidate.validation);
    assert.equal((await f.read()).candidate.runId,undefined,"saving never starts a run");
    assert.deepEqual(await saveAuthor(f.task,f.pkg.digest),saved,"saving is idempotent");
  }
});

test("manual preview trials need no checks and preserve action records and idempotent requests",async()=>{
  const f=await fixture();await f.call("eureka_app_write",f.input);
  const revision=(await f.read()).candidate.revision,id=randomUUID();
  await authorManualTest(f.task,f.task.id,revision,id,{text:"abc"},0,"count");
  const record=await until(()=>getAppRun(f.access,f.task.id,id),r=>["completed","failed"].includes(r.status));
  assert.equal(record.status,"completed",record.error);
  await until(()=>appHasLease(f.access.store.dataDirectory(f.task.id)),v=>!v);
  assert.deepEqual(await appRunValue(f.access,f.task.id,id,record.resultRef),[{characters:3,lines:1}]);
  const trial=(await f.read()).candidate;
  assert.equal(trial.runId,id);assert.equal(trial.actionTrials.count.runId,id);assert.equal(trial.validation,undefined);
  const nextId=randomUUID();
  await authorManualTest(f.task,f.task.id,revision,nextId,{text:"abc"},0,"uppercase");
  const next=await until(()=>getAppRun(f.access,f.task.id,nextId),r=>["completed","failed"].includes(r.status));
  assert.equal(next.status,"completed",next.error);
  await until(()=>appHasLease(f.access.store.dataDirectory(f.task.id)),v=>!v);
  assert.deepEqual(await appRunValue(f.access,f.task.id,nextId,next.resultRef),[{output:"ABC"}]);
  const replay=await authorManualTest(f.task,f.task.id,revision,id,{text:"abc"},0,"count");
  assert.equal(replay.id,id);
  assert.equal((await f.read()).candidate.runId,nextId,"replaying an old HTTP request cannot replace the latest trial");
  await assert.rejects(()=>authorManualTest(f.task,f.task.id,revision,id,{text:"changed"},0,"count"),/另一项请求|请求已变化/);
  await saveAuthor(f.task,f.pkg.digest);
  await assert.rejects(()=>authorManualTest(f.task,f.task.id,revision,randomUUID(),{text:"abc"},1,"count"),/代码已变化/);
});

test("saving still rejects stale digests and active trials; manual startup failures preserve the previous candidate",async()=>{
  const f=await fixture(files=>{files["scripts/count.mjs"]=files["scripts/count.mjs"].replace('const text=await','await ctx.sleep(1000); const text=await');});
  await f.call("eureka_app_write",f.input);
  const before=(await f.read()).candidate,revision=before.revision;
  await assert.rejects(()=>saveAuthor(f.task,"0".repeat(64)),/代码已变化/);
  await assert.rejects(()=>authorManualTest(f.task,randomUUID(),revision,randomUUID(),{text:"abc"},0,"count"),/代码已变化/);
  await assert.rejects(()=>authorManualTest(f.task,f.task.id,revision,randomUUID(),{text:"abc"},99,"count"),/配置已变化/);
  assert.deepEqual((await f.read()).candidate,before);
  const id=randomUUID();
  try{
    await authorManualTest(f.task,f.task.id,revision,id,{text:"abc"},0,"count");
    await assert.rejects(()=>saveAuthor(f.task,f.pkg.digest),/正在运行|停止中/);
    await assert.rejects(()=>authorManualTest(f.task,f.task.id,revision,randomUUID(),{text:"abc"},0,"uppercase"),/尚未结束/);
  }finally{
    await stopAppRun(f.access,f.task.id,id);
    await until(()=>appHasLease(f.access.store.dataDirectory(f.task.id)),v=>!v);
  }
  assert.equal((await saveAuthor(f.task,f.pkg.digest)).id,f.task.id,"a stopped unvalidated trial does not block saving");
});


test("model tools cannot run tests or inspect manual results, even through task or evidence reads",async()=>{
  assert.equal(tools.has("eureka_app_test"),false);assert.equal(tools.has("eureka_app_validate"),false);
  for(const toolName of ["eureka_app_test","eureka_app_validate"]){const result=await hooks.get("tool_call")({toolName},{sessionManager:{}});assert.equal(result.block,true);}
  const f=await fixture();await f.call("eureka_app_write",f.input);
  const state=await f.read(),marker="private-manual-trial-marker";
  state.candidate.runId=randomUUID();state.candidate.lastError=marker;state.candidate.checks=[{source:"result",expected:marker}];
  state.evidence.push({id:"run:private:1",method:"read",at:"fixture",runId:state.candidate.runId,value:{secret:marker}});
  await f.access.host.privateJson(f.stateFile,state);
  const snapshot=await f.call("eureka_automation_task");
  assert.equal(snapshot.testing,"manual-only");assert.equal(snapshot.state,undefined);
  assert.equal(JSON.stringify(snapshot).includes(marker),false);
  assert.equal(JSON.stringify(snapshot).includes(state.candidate.runId),false);
  await assert.rejects(()=>f.call("eureka_automation_task",{evidenceId:"run:private:1"}),/人工试运行结果/);
});

test("small edits retain the version, merge unchanged files and keep immutable previous code",async()=>{
  const f=await fixture();const initial=await f.call("eureka_app_write",f.input);
  const old=await f.access.store.detail(f.task.id);
  const edit={path:"scripts/count.mjs",oldText:"Array.from(text).length",newText:"Array.from(text).length+1"};
  const revised=await f.call("eureka_app_write",{baseDigest:initial.digest,edits:[edit]});
  assert.equal(revised.version,initial.version);assert.notEqual(revised.digest,initial.digest);assert.ok(revised.revision>initial.revision);
  assert.deepEqual(revised.changedFiles,[edit.path]);
  const detail=await f.access.store.detail(f.task.id);
  assert.equal(detail.install.versions.length,1);
  assert.equal(await readFile(join(old.codeDirectory,edit.path),"utf8"),f.files[edit.path]);
  assert.equal(await readFile(join(detail.codeDirectory,edit.path),"utf8"),f.files[edit.path].replace(edit.oldText,edit.newText));
  assert.equal(await readFile(join(detail.codeDirectory,"ui.json"),"utf8"),f.files["ui.json"]);
  await assert.rejects(()=>f.call("eureka_app_write",{baseDigest:initial.digest,files:{"README.md":"stale"}}),/baseDigest/);
  await assert.rejects(()=>f.call("eureka_app_write",{baseDigest:revised.digest,edits:[{path:edit.path,oldText:"text",newText:"x"}]}),/唯一匹配/);
  assert.equal((await f.read()).candidate.digest,revised.digest);
  const page=await f.call("eureka_automation_task",{file:edit.path,search:"Array.from",limit:1000});
  assert.equal(page.digest,revised.digest);assert.ok(page.text.includes(edit.newText));assert.equal(page.nextOffset,null);
  const added=await f.call("eureka_app_write",{baseDigest:revised.digest,files:{"scripts/shared.mjs":"export const value=1;"}});
  assert.deepEqual(added.changedFiles.sort(),["plugin.json","scripts/shared.mjs"]);
  const removed=await f.call("eureka_app_write",{baseDigest:added.digest,deleteFiles:["scripts/shared.mjs"]});
  assert.deepEqual(removed.deletedFiles,["scripts/shared.mjs"]);
  await assert.rejects(()=>f.call("eureka_app_write",{baseDigest:removed.digest,deleteFiles:["README.md"]}));
  assert.equal((await f.read()).candidate.digest,removed.digest);
});

test("save then edit then save increments the version and retains immutable history with revision guards",async()=>{
  const f=await fixture();await f.call("eureka_app_write",f.input);
  const first=await saveAuthor(f.task,f.pkg.digest,"持续修订应用");
  const before=await f.access.host.detail(first.id);
  const revised=await f.call("eureka_app_write",{baseDigest:f.pkg.digest,files:{"README.md":"# Revised manually tested application\n"}});
  assert.equal(revised.saved,false);assert.equal(revised.version,"1.0.1");
  assert.equal((await f.call("eureka_automation_task")).active,true);
  assert.equal((await f.access.host.detail(first.id)).install.revision,before.install.revision,"editing does not implicitly save");
  const second=await saveAuthor(f.task,revised.digest);
  const after=await f.access.host.detail(first.id);
  assert.equal(second.displayName,first.displayName);assert.equal(second.id,first.id);assert.equal(second.version,"1.0.1");assert.equal(after.install.versions.length,2);
  assert.ok(after.install.revision>before.install.revision);
  assert.equal(after.readme,"# Revised manually tested application\n");
  assert.equal(await readFile(join(before.codeDirectory,"README.md"),"utf8"),f.files["README.md"]);
  const next=await f.call("eureka_app_write",{baseDigest:revised.digest,files:{"README.md":"# Pending update\n"}});
  await f.access.host.change(first.id,after.install.revision,"disable");
  await assert.rejects(()=>saveAuthor(f.task,next.digest),/应用登记已变化/);
  assert.equal((await f.access.host.detail(first.id)).readme,"# Revised manually tested application\n");
});


test("large read-only exploration is stored privately, paged, deduplicated and task-scoped",async()=>{
  const f=await fixture(),rows=Array.from({length:100},(_,i)=>({id:String(i),payload:"业务数据".repeat(1000)}));
  f.access.actor.browser={options:{detail:{manifest:{automation:{browser:{sites:[{operations:[]}]}}}}},call:async()=>({rows}),close(){}};
  const first=await f.call("eureka_app_browser",{method:"read",args:[{}]});
  assert.ok(Buffer.byteLength(JSON.stringify(first))<24000);assert.equal(first.omitted,true);
  const state=await f.read();assert.equal(state.evidence.length,1);assert.equal(state.evidence[0].valueRef,first.evidenceId);
  const page=await f.call("eureka_automation_task",{evidenceId:first.evidenceId,path:"/rows",fields:["id"],offset:90,limit:5});
  assert.deepEqual(page.values,[90,91,92,93,94].map(i=>({id:String(i)})));assert.equal(page.total,100);assert.equal(page.nextOffset,95);
  const repeat=await f.call("eureka_app_browser",{method:"read",args:[{}]});
  assert.equal(repeat.unchanged,true);assert.equal(repeat.evidenceId,first.evidenceId);assert.equal((await f.read()).evidence.length,1);
  const other=await fixture();await assert.rejects(()=>other.call("eureka_automation_task",{evidenceId:first.evidenceId}),/本任务/);
  assert.equal((await f.call("eureka_automation_task")).state,undefined);
});


test("modifying an installed base automatically bumps its version and retains the original package",async()=>{
  const original=await fixture();await original.call("eureka_app_write",original.input);const saved=await saveAuthor(original.task,original.pkg.digest);
  const installed=await original.access.host.detail(saved.id);
  const f=await fixture(()=>{},{id:saved.id,revision:installed.install.revision,version:installed.manifest.version});
  const task=await f.call("eureka_automation_task");assert.equal(task.candidate,null);assert.equal(task.suggestedAppId,saved.id);
  const revised=await f.call("eureka_app_write",{baseDigest:task.digest,files:{"README.md":"# Partial base revision"}});
  assert.equal(revised.appId,saved.id);assert.equal(revised.version,"1.0.1");
  assert.deepEqual(revised.changedFiles.sort(),["README.md","package.json","plugin.json"].sort());
  const after=await saveAuthor(f.task,revised.digest);
  assert.equal(after.id,saved.id);assert.equal(after.version,"1.0.1");
  assert.equal((await f.access.host.detail(saved.id)).install.versions.length,2);
  // The original launch reference remains immutable while the same task moves
  // forward through its own saved versions, including after being paused.
  await changeAutomationTask(f.manager,f.task,"paused");
  bindAutomationTask(f.manager,await changeAutomationTask(f.manager,f.task,"active","继续修改当前应用"));
  f.access=await authorAccess(f.task);
  const savedBase=await f.call("eureka_automation_task",{source:"base",file:"README.md"});
  assert.equal(savedBase.text,"# Partial base revision");
  const continued=await f.call("eureka_app_write",{baseDigest:revised.digest,files:{"README.md":"# Continued in original conversation"}});
  assert.equal(continued.version,"1.0.2");
  const second=await saveAuthor(f.task,continued.digest);
  assert.equal(second.id,saved.id);assert.equal(second.version,"1.0.2");
  assert.equal((await f.access.host.detail(saved.id)).install.versions.length,3);
  assert.equal((await f.access.host.detail(saved.id,"1.0.1")).readme,"# Partial base revision");
  assert.equal((await f.call("eureka_automation_task",{source:"base",file:"README.md"})).text,"# Continued in original conversation");
});

test("a committed versioned save recovers its publication revision after a failed final task-state write",async()=>{
  const f=await fixture();await f.call("eureka_app_write",f.input);await saveAuthor(f.task,f.pkg.digest,"保存名称");
  const revised=await f.call("eureka_app_write",{baseDigest:f.pkg.digest,files:{"README.md":"# Committed edit"}});
  const original=AutomationAppStore.prototype.privateJson;let failed=false;
  AutomationAppStore.prototype.privateJson=async function(path,value){if(path===f.stateFile&&value.candidate?.saved&&!failed){failed=true;throw Object.assign(new Error("EPERM final save fixture"),{code:"EPERM"});}return original.call(this,path,value);};
  try{await assert.rejects(()=>saveAuthor(f.task,revised.digest),/EPERM/);}finally{AutomationAppStore.prototype.privateJson=original;}
  assert.equal(failed,true);const actual=await f.access.host.detail(f.task.id);assert.equal(actual.readme,"# Committed edit");
  const recovered=await f.call("eureka_automation_task");assert.equal(recovered.candidate.saved,true);
  assert.equal((await f.read()).publication.revision,actual.install.revision);
  const next=await f.call("eureka_app_write",{baseDigest:revised.digest,files:{"README.md":"# Next edit"}});
  assert.equal((await saveAuthor(f.task,next.digest)).displayName,"保存名称");
});

test("editing a historical base branches into the next latest version and keeps draft edits in one version",async()=>{
  const f=await fixture();await f.call("eureka_app_write",f.input);const first=await saveAuthor(f.task,f.pkg.digest);
  const update=await f.call("eureka_app_write",{baseDigest:f.pkg.digest,files:{"README.md":"# Latest revision"}});
  await saveAuthor(f.task,update.digest);const latest=await f.access.host.detail(first.id);
  const branch=await fixture(()=>{},{id:first.id,revision:latest.install.revision,version:"1.0.0"});
  const base=await branch.call("eureka_automation_task");
  const changed=await branch.call("eureka_app_write",{baseDigest:base.digest,files:{"README.md":"# Historical base revision"}});
  assert.equal(changed.version,"1.0.2");
  const edited=await branch.call("eureka_app_write",{baseDigest:changed.digest,files:{"README.md":"# Historical base final"}});
  assert.equal(edited.version,"1.0.2");await saveAuthor(branch.task,edited.digest);
  const current=await branch.access.host.detail(first.id);assert.equal(current.manifest.version,"1.0.2");assert.equal(current.install.versions.length,3);
  assert.equal((await branch.access.host.detail(first.id,"1.0.1")).readme,"# Latest revision");
  assert.equal((await branch.access.host.detail(first.id,"1.0.2")).readme,"# Historical base final");
});


test("legacy saved-and-exited conversations resolve the owned installed app for a fresh editing task",async()=>{
  const f=await fixture();await f.call("eureka_app_write",f.input);await saveAuthor(f.task,f.pkg.digest,"继续修改的应用");
  await changeAutomationTask(f.manager,f.task,"exited");
  const reference=await authorSavedReference(f.task);const fresh=await authorAccess(f.task,true),actual=await fresh.host.detail(f.task.id);
  assert.deepEqual(reference,{id:f.task.id,revision:actual.install.revision,version:actual.manifest.version,displayName:"继续修改的应用"});
  const next=await fixture(()=>{},reference),view=await next.call("eureka_automation_task");
  assert.equal(view.suggestedAppId,f.task.id);
  const changed=await next.call("eureka_app_write",{baseDigest:view.digest,files:{"README.md":"# Continued legacy conversation"}});
  assert.equal(changed.appId,f.task.id);assert.equal(changed.version,"1.0.1");
});
