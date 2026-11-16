import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
const {automationExampleFiles}=await jiti.import("./automation-app-example.ts");
const {inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
const {versionedAppStore}=await jiti.import("./automation-app-version-scope.ts");
const {nextAppVersion}=await jiti.import("./automation-app-version.ts");
const {withAutomationAppVersion}=await jiti.import("./automation-app-metadata.ts");

test("automatic version updates both manifests without mutating the source package",()=>{
  const original=inspectAutomationFiles(automationExampleFiles()),next=withAutomationAppVersion(original,nextAppVersion(original.manifest.version));
  assert.equal(next.manifest.version,"1.0.1");assert.equal(JSON.parse(next.files.get("package.json")).version,"1.0.1");
  assert.equal(original.manifest.version,"1.0.0");assert.notEqual(next.digest,original.digest);
  assert.equal(nextAppVersion("1.9.99"),"1.9.100");assert.equal(nextAppVersion("2.0.0-beta.2"),"2.0.1");
});
test("history selection pins package admission while the directory remains latest",async()=>{
  const root=await mkdtemp(join(tmpdir(),"eureka-version-"));
  try{
    const store=new AutomationAppStore(root,"a".repeat(64),()=>{});
    const one=inspectAutomationFiles(automationExampleFiles());const first=await store.install(one,0);
    const before=await store.detail(first.id),bytes=await readFile(join(before.codeDirectory,"plugin.json"));
    const two=withAutomationAppVersion(one,"1.0.1"),second=await store.install(two,first.revision);
    const selected=versionedAppStore(store,first.id,"1.0.0");
    assert.equal((await selected.detail(first.id)).manifest.version,"1.0.0");
    assert.equal((await store.detail(first.id)).manifest.version,"1.0.1");
    const run=await selected.admitRun(first.id,second.revision,async(detail,pkg)=>({version:detail.manifest.version,digest:pkg.digest,directory:detail.codeDirectory}));
    assert.deepEqual(run,{version:"1.0.0",digest:one.digest,directory:before.codeDirectory});
    assert.equal((await store.find(first.id)).activeVersion,"1.0.1");assert.equal((await store.find(first.id)).versions.length,2);
    assert.deepEqual(await readFile(join(before.codeDirectory,"plugin.json")),bytes);
    await assert.rejects(selected.admitRun(first.id,first.revision,async()=>true),/已变化/);
    await assert.rejects(versionedAppStore(store,first.id,"9.0.0").detail(first.id),/未安装此版本/);
    assert.equal((await store.detail(first.id)).manifest.version,"1.0.1");
  }finally{await rm(root,{recursive:true,force:true});}
});
