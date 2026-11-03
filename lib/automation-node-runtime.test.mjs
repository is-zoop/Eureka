// Regression sources only; execute manually. No business websites or models.
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,toNamespacedPath} from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {createJiti} from "jiti";
const jiti=createJiti(import.meta.url);
const {automationLaunchDirectories,automationStartError,automationFilePermissionFlags}=await jiti.import("./automation-node-runtime.ts");
test("Windows long cwd is not passed to CreateProcess; runtime directory replaces PATH lookup",()=>{
  const workspace=join(tmpdir(),"long".repeat(100));
  const values=automationLaunchDirectories(workspace,process.execPath,"win32");
  assert.ok(!values.includes(workspace));assert.ok(values.includes(dirname(process.execPath)));assert.ok(values.every(p=>p.length<240));
  assert.deepEqual(values,[dirname(process.execPath)]);
  assert.deepEqual(automationLaunchDirectories("relative",process.execPath,process.platform),[dirname(process.execPath)]);
});
test("ENOENT is reported as a launch failure, not proof that Node is missing; raw paths are omitted",()=>{
  const text=automationStartError({code:"ENOENT",message:"spawn private-runtime-path ENOENT"});
  assert.match(text,/ENOENT/);assert.match(text,/控制进程启动失败/);assert.ok(!text.includes("private-runtime-path"));
  assert.ok(!text.includes("未安装"));
  assert.match(automationStartError({code:"EPIPE"},"ipc"),/进程通信失败（EPIPE）/);
});

test("directory grants explicitly cover descendants while selected files remain exact and read-only",()=>{
  const code=join(tmpdir(),"long-code-".repeat(30)),workspace=join(tmpdir(),"app workspace"),selected=join(tmpdir(),"business.csv");
  const flags=automationFilePermissionFlags([{path:code,kind:"directory"},{path:workspace,kind:"directory"},{path:selected,kind:"file"}],[{path:workspace,kind:"directory"}]);
  assert.ok(flags.includes(`--allow-fs-read=${join(code,"*")}`));
  assert.ok(flags.includes(`--allow-fs-write=${join(workspace,"*")}`));
  assert.ok(flags.includes(`--allow-fs-read=${selected}`));
  assert.ok(!flags.some(flag=>flag.startsWith("--allow-fs-write="+selected)||flag==="--allow-fs-read="+join(selected,"*")));
  assert.ok(!flags.includes("--allow-fs-read=*")&&!flags.includes("--allow-fs-write=*"));
  assert.throws(()=>automationFilePermissionFlags([{path:join(tmpdir(),"bad*"),kind:"directory"}],[]),/授权路径/);
});
test("creation avoids duplicated long cwd; script cwd and SDK use the same compact private workspace",async()=>{
  const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
  const {fileAutomationExample}=await jiti.import("./automation-app-example.ts");
  const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
  const {startAppRun,getAppRun,appRunValue,stopAppRun}=await jiti.import("./automation-app-runtime.ts");
  const {appHasLease}=await jiti.import("./automation-app-lease.ts");
  const root=await mkdtemp(join(tmpdir(),"eureka-long-cwd-"));
  const privateFile=join(root,"host-private.txt");await writeFile(privateFile,"must-stay-private");
  const store=new AutomationAppStore(join(root,"private".repeat(3),"a".repeat(64),randomUUID(),"rt"),"a".repeat(64),()=>{},{compactWorkspace:true});
  let pkg=parseAutomationAppArchive(fileAutomationExample());
  const manifest=JSON.parse(pkg.files.get("plugin.json"));manifest.extensions["com.eureka"].automation.capabilities.push("files.write");manifest.extensions["com.eureka"].automation.files.push("scripts/helper.mjs","scripts/value.txt");pkg.files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  const ui=JSON.parse(pkg.files.get("ui.json"));ui.fields=[];ui.results.columns=[];pkg.files.set("ui.json",Buffer.from(JSON.stringify(ui)));
  pkg.files.set("scripts/helper.mjs",Buffer.from('export const marker="local-module-ok";'));
  pkg.files.set("scripts/value.txt",Buffer.from("local-asset-ok"));
  pkg.files.set("scripts/main.mjs",Buffer.from(`import {readFileSync} from "node:fs";import {marker} from "./helper.mjs";export default async ctx => ctx.step("read", null, async () => {const asset=readFileSync(new URL("./value.txt",import.meta.url),"utf8");let denied;try{readFileSync(${JSON.stringify(privateFile)},"utf8");}catch(error){denied=error.code;}const ref=ctx.files.child(ctx.files.workspace,"proof.txt");await ctx.files.writeText(ref,"workspace-ok");return {cwd:process.cwd(),value:await ctx.files.readText(ref),marker,asset,denied};});`));
  pkg=inspectAutomationFiles(pkg.files);const install=await store.install(pkg,0),id=randomUUID(),auth={ownerKey:"a".repeat(64),runtimeId:"test",store,assertIdentity:()=>{}};
  async function until(read,accept){for(let i=0;i<300;i++){const value=await read();if(accept(value))return value;await delay(50);}throw new Error("worker did not finish");}
  try {
    assert.ok(join(store.dataDirectory(install.id),"workspace").length>260);
    assert.ok(store.workspaceDirectory(install.id).length<240);
    await startAppRun(auth,install.id,install.revision,id,{},0);
    const run=await until(()=>getAppRun(auth,install.id,id),r=>["completed","failed","interrupted"].includes(r.status));
    assert.equal(run.status,"completed",run.error);const output=await appRunValue(auth,install.id,id,run.resultRef);
    assert.equal(output.value,"workspace-ok");
    assert.equal(output.marker,"local-module-ok");assert.equal(output.asset,"local-asset-ok");assert.equal(output.denied,"ERR_ACCESS_DENIED");
    const normal=p=>toNamespacedPath(p).toLowerCase();
    assert.equal(normal(output.cwd),normal(store.workspaceDirectory(install.id)));
  } finally {
    await stopAppRun(auth,install.id,id).catch(()=>{});await until(()=>appHasLease(store.dataDirectory(install.id)),value=>!value);await rm(root,{recursive:true,force:true});
  }
});
