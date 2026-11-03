// Test sources only; installation never executes the package's business script.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,mkdir,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { fixtureZip } from "./haze-plugin-fixture.mjs";

test("organization automations reuse Plugin lifecycle and isolate installer data",async t=>{
  const root=await mkdtemp(join(tmpdir(),"eureka-org-auto-")),cwd=join(root,"project"),agent=join(root,"agent");await mkdir(cwd);await mkdir(agent);
  const env={PI_CODING_AGENT_DIR:agent,EUREKA_AUTH_HAZE_ISSUER:"https://haze.example",EUREKA_AUTH_CLIENT_ID:"test-client",EUREKA_AUTH_REDIRECT_URI:"http://localhost/callback",EUREKA_AUTH_SESSION_SECRET:"test-only-organization-plugin-secret-32"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
  const originalFetch=globalThis.fetch;let archive;
  globalThis.fetch=async input=>String(input).endsWith("/access-prompt")?Response.json({data:{download_url:"https://haze.example/download/test"}}):new Response(archive);
  t.after(async()=>{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});});
  const jiti=createJiti(import.meta.url,{tsconfigPaths:true,alias:{"server-only":resolve("node_modules/next/dist/compiled/server-only/empty.js")}});
  const {fileAutomationExample}=await jiti.import("./automation-app-example.ts");
  const {parseAutomationAppArchive}=await jiti.import("./automation-app-package.ts");
  const {parseOrganizationPluginArchive}=await jiti.import("./haze-automation-package.ts");
  const {AutomationAppStore}=await jiti.import("./automation-app-store.ts");
  const {automationOwnerKey}=await jiti.import("./automation-owner.ts");
  const {syncOrganizationAutomations}=await jiti.import("./haze-automation-install.ts");
  const {assertManagedAutomationEnabled}=await jiti.import("./automation-managed-source.ts");
  const install=await jiti.import("./haze-plugin-install.ts"),registry=await jiti.import("./haze-registry.ts");
  const source="https://haze.example",session={principal:{subject:"user-a",permissions:["page.marketplace"]},refreshToken:"test-only",providerId:"haze-oidc",expiresAt:Date.now()+10000};
  const input={cwd,scope:"project",capabilityId:"42",name:"文件工具",version:"1.0.0",operation:"install",session,accessToken:"test-only"};
  const userA={source,subject:"user-a",check:()=>{}},userB={source,subject:"user-b",check:()=>{}};
  const storeA=new AutomationAppStore(agent,automationOwnerKey(source,"user-a"),()=>{}),storeB=new AutomationAppStore(agent,automationOwnerKey(source,"user-b"),()=>{});
  const pkg=parseAutomationAppArchive(fileAutomationExample()),id=pkg.manifest.automation.id;
  function example(version="1.0.0"){const candidate=parseAutomationAppArchive(fileAutomationExample(version));candidate.files.set(candidate.manifest.automation.entry,Buffer.from(`globalThis.__organizationAutomationEntryExecuted=true;\n${candidate.files.get(candidate.manifest.automation.entry).toString("utf8")}`));return fixtureZip(Object.fromEntries(candidate.files));}
  archive=example();let installed;
  async function commit(options){const prepared=await install.prepareOrganizationPlugin(options);return install.commitOrganizationPlugin({...options,preparationToken:prepared.preparationToken,approveAddresses:false});}
  await t.test("manifest routing accepts ordinary plugins and fails closed on malformed automation",()=>{
    assert.equal(parseOrganizationPluginArchive(fixtureZip(),"2.1.0").automation,undefined);
    assert.equal(parseOrganizationPluginArchive(archive,"1.0.0").automation.manifest.automation.id,id);
    assert.throws(()=>parseOrganizationPluginArchive(archive,"2.0.0"),/版本/);
    const files=Object.fromEntries([...pkg.files].map(([name,bytes])=>[name,bytes]));
    assert.throws(()=>parseOrganizationPluginArchive(fixtureZip({...files,"config.json":'{"secret":"creator-data"}'}),"1.0.0"));
    const manifest=JSON.parse(files["plugin.json"]);manifest.extensions["com.eureka"].automation=null;
    assert.throws(()=>parseOrganizationPluginArchive(fixtureZip({...files,"plugin.json":JSON.stringify(manifest)}),"1.0.0"));
  });
  await t.test("install registers in automation without copying private values",async()=>{
    installed=await commit(input);assert.equal(installed.type,"Plugin");assert.equal(installed.plugin.manifest.automation.id,id);
    assert.equal(globalThis.__organizationAutomationEntryExecuted,undefined);
    const {listComposerPlugins}=await jiti.import("./composer-plugins.ts"),{pluginPresentation}=await jiti.import("./haze-plugin-resources.ts");
    assert.equal(listComposerPlugins(cwd,source,"user-a").length,0);
    assert.equal(pluginPresentation(installed,"ordinary-chat","user-a").state,"installed");
    const app=await storeA.find(id);assert.equal(app.activeVersion,"1.0.0");assert.equal(app.managedPlugin.capabilityId,"42");
    assert.deepEqual(JSON.parse(await readFile(join(storeA.dataDirectory(id),"config.json"),"utf8")).values,{});
    await storeA.privateJson(join(storeA.dataDirectory(id),"config.json"),{schemaVersion:1,revision:1,values:{privateValue:"only-user-a"}});
    await storeA.privateJson(join(storeA.dataDirectory(id),"browser-settings.json"),{environments:{private:"only-user-a"}});
    await syncOrganizationAutomations(userB,cwd);
    assert.ok(await storeB.find(id));assert.notEqual(storeA.dataDirectory(id),storeB.dataDirectory(id));
    const revision=(await storeB.find(id)).revision;
    await syncOrganizationAutomations(userB,cwd);assert.equal((await storeB.find(id)).revision,revision);
    assert.deepEqual(JSON.parse(await readFile(join(storeB.dataDirectory(id),"config.json"),"utf8")).values,{});
    await assert.rejects(readFile(join(storeB.dataDirectory(id),"browser-settings.json")),/ENOENT/);
    await assert.rejects(storeA.export(id), /另存/);
    const copy=await storeA.saveAs(id,(await storeA.find(id)).revision,randomUUID(),"个人副本");
    const exported=parseAutomationAppArchive((await storeA.export(copy.id)).bytes);
    assert.ok([...exported.files.keys()].every(name=>!/(?:config|grants|browser-settings|logs|evidence)\//.test(name)));
    assert.ok(![...exported.files.values()].some(bytes=>bytes.includes("only-user-a")));
    await storeA.uninstall(copy.id,copy.revision,undefined,true);
  });
  await t.test("plugin disable fences stale access and direct app lifecycle cannot bypass it",async()=>{
    const stale=await storeB.find(id);await install.mutateOrganizationPlugin(cwd,"project","42",session,"set-disabled",true);
    assert.equal((await storeA.find(id)).disabled,true);assert.throws(()=>assertManagedAutomationEnabled(id,stale.managedPlugin),/停用/);
    await syncOrganizationAutomations(userB,cwd);assert.equal((await storeB.find(id)).disabled,true);
    const app=await storeA.find(id);let invoked=false;
    await assert.rejects(storeA.admitRun(id,app.revision,async()=>{invoked=true;}),/停用/);assert.equal(invoked,false);
    await assert.rejects(storeA.change(id,app.revision,"enable"),/组织插件/);
    await assert.rejects(storeA.uninstall(id,app.revision),/组织插件/);
    await assert.rejects(storeA.install(pkg,app.revision),/组织插件/);
    await install.mutateOrganizationPlugin(cwd,"project","42",session,"set-disabled",false);assert.equal((await storeA.find(id)).disabled,false);
  });
  await t.test("update retains personal configuration and global/project registrations do not duplicate apps",async()=>{
    archive=example("1.1.0");installed=await commit({...input,version:"1.1.0",operation:"update"});
    assert.equal((await storeA.find(id)).activeVersion,"1.1.0");
    assert.equal(JSON.parse(await readFile(join(storeA.dataDirectory(id),"config.json"),"utf8")).values.privateValue,"only-user-a");
    await syncOrganizationAutomations(userB,cwd);assert.equal((await storeB.find(id)).activeVersion,"1.1.0");
    await commit({...input,scope:"global",version:"1.1.0"});
    assert.equal((await storeA.list()).apps.length,1);
    const projectGrant={...(await storeA.find(id)).managedPlugin,locations:[{scope:"project",cwd}]};
    await install.mutateOrganizationPlugin(cwd,"project","42",session,"uninstall");assert.ok(await storeA.find(id));
    assert.throws(()=>assertManagedAutomationEnabled(id,projectGrant),/卸载/);
    const remainingSource=(await storeA.find(id)).managedPlugin;
    assert.doesNotThrow(()=>assertManagedAutomationEnabled(id,remainingSource));
    await syncOrganizationAutomations(userB,cwd);
    await install.mutateOrganizationPlugin(cwd,"global","42",session,"uninstall");assert.equal(await storeA.find(id),null);
    await syncOrganizationAutomations(userB,cwd);assert.equal(await storeB.find(id),null);
    assert.equal(JSON.parse(await readFile(join(storeA.dataDirectory(id),"config.json"),"utf8")).values.privateValue,"only-user-a");
    assert.equal(globalThis.__organizationAutomationEntryExecuted,undefined);
  });
  await t.test("uninstall cleanup respects shared scopes and deletes only the requesting owner's data",async()=>{
    archive=example("1.1.0");
    await commit({...input,version:"1.1.0"});await commit({...input,scope:"global",version:"1.1.0"});
    const otherConfig=await readFile(join(storeB.dataDirectory(id),"config.json"),"utf8");
    await assert.rejects(install.mutateOrganizationPlugin(cwd,"project","42",session,"uninstall",undefined,true),/共享用户数据/);
    assert.ok(registry.readHazeRegistry(cwd,"project").installs.some(item=>item.capabilityId==="42"));
    assert.equal(JSON.parse(await readFile(join(storeA.dataDirectory(id),"config.json"),"utf8")).values.privateValue,"only-user-a");
    await install.mutateOrganizationPlugin(cwd,"project","42",session,"uninstall");
    await install.mutateOrganizationPlugin(cwd,"global","42",session,"uninstall",undefined,true);
    assert.equal(await storeA.find(id),null);
    await assert.rejects(readFile(join(storeA.dataDirectory(id),"config.json")),{code:"ENOENT"});
    assert.equal(await readFile(join(storeB.dataDirectory(id),"config.json"),"utf8"),otherConfig);
  });
  await t.test("a conflicting personal app makes plugin installation roll back",async()=>{
    await storeA.install(pkg,0);archive=fileAutomationExample();
    await assert.rejects(commit({...input,capabilityId:"84"}),/同 ID/);
    assert.equal(registry.readHazeRegistry(cwd,"project").installs.some(item=>item.capabilityId==="84"),false);
    assert.equal((await storeA.find(id)).managedPlugin,undefined);
  });
});
