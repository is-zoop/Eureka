import { lstat,readFile,realpath } from "node:fs/promises";
import { join,resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AutomationAppStore } from "./automation-app-store";
import { AutomationAppError,automationPublishPath,inspectAutomationFiles,MAX_APP_EXPANDED } from "./automation-app-package";
import type { ManagedAutomationPlugin } from "./automation-app";
import { managedAutomationState } from "./automation-managed-source";
import { automationOwnerKey } from "./automation-owner";
import { readHazeRegistry,type HazeInstallScope,type HazeManagedInstall } from "./haze-registry";
import { validatedPluginRoot } from "./haze-plugin-resources";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";
import { interruptManagedApplicationRuns } from "./automation-app-runtime";

type User={source:string;subject:string;check:()=>void};
function storeFor(user:User){return new AutomationAppStore(getAgentDir(),automationOwnerKey(user.source,user.subject),user.check);}
async function locked<T>(store:AutomationAppStore,work:()=>Promise<T>){await store.ensureDataDirectory(store.registryDirectory);const release=await lockfile.lock(join(store.registryDirectory,"organization-sync"),{realpath:false,retries:{retries:40,minTimeout:25,maxTimeout:100}});try{return await work();}finally{await release();}}
function sameSource(a:ManagedAutomationPlugin,b:ManagedAutomationPlugin){return a.source===b.source&&a.capabilityId===b.capabilityId;}
function addLocation(source:ManagedAutomationPlugin,cwd:string,scope:HazeInstallScope):ManagedAutomationPlugin {
  if(source.locations.some(location=>location.scope===scope&&(scope==="global"||samePath(location.cwd,cwd))))return source;
  return {...source,locations:[...source.locations,{scope,cwd:resolve(cwd)}]};
}
async function readAutomationPackage(location:ManagedAutomationPlugin["locations"][number],item:HazeManagedInstall){
  const root=validatedPluginRoot(location.cwd,item),files=new Map<string,Buffer>();let total=0;
  for(const raw of item.plugin!.manifest.automation!.files){const name=automationPublishPath(raw),path=resolve(root,...name.split("/")),actual=await realpath(path),info=await lstat(path);if(!isPathWithinRoots(actual,new Set([root]))||info.isSymbolicLink()||!info.isFile()||info.size>MAX_APP_EXPANDED-total)throw new AutomationAppError("组织插件代码路径或大小无效",409);const bytes=await readFile(path);total+=bytes.length;if(total>MAX_APP_EXPANDED)throw new AutomationAppError("组织插件代码超过大小限制",409);files.set(name,bytes);}
  const pkg=inspectAutomationFiles(files);
  if(pkg.digest!==item.plugin!.manifest.automation!.digest||pkg.manifest.version!==item.version)throw new AutomationAppError("组织插件代码与安装登记不一致，请重新安装。",409);
  return pkg;
}
/** Recoverable projection. Haze remains the sole lifecycle authority. */
async function syncOne(store:AutomationAppStore,user:User,id:string,source:ManagedAutomationPlugin,deleteData=false){
  user.check();const old=await store.find(id);
  if(old&&(!old.managedPlugin||!sameSource(old.managedPlugin,source)))throw new AutomationAppError("本机已有同 ID 的个人应用或另一插件应用，请先在原管理入口卸载，个人数据会保留。",409);
  const state=managedAutomationState(id,source);
  if(!state.selected){
    if(old){await interruptManagedApplicationRuns(automationOwnerKey(user.source,user.subject),id);user.check();return store.uninstall(id,old.revision,source,deleteData);}
    if(deleteData){user.check();await store.clearData(id,0);}return;
  }
  if(deleteData)throw new AutomationAppError("此插件仍在其他范围安装，不能删除共享用户数据。请先卸载其他安装，或取消勾选删除数据。",409);
  if(state.disabled)await interruptManagedApplicationRuns(automationOwnerKey(user.source,user.subject),id);
  const selected=state.selected,version=old?.versions.find(version=>version.version===selected.item.version);
  if(old&&old.activeVersion===selected.item.version&&version?.digest===selected.item.plugin!.manifest.automation!.digest&&old.disabled===state.disabled&&JSON.stringify(old.managedPlugin)===JSON.stringify(source))return;
  const pkg=await readAutomationPackage(selected.location,selected.item);user.check();
  await store.install(pkg,old?.revision??0,{source,disabled:state.disabled});
}
export async function syncOrganizationAutomation(user:User,cwd:string,scope:HazeInstallScope,capabilityId:string,id:string,deleteData=false){
  const store=storeFor(user);return locked(store,async()=>{const old=await store.find(id),source=addLocation(old?.managedPlugin&&old.managedPlugin.source===user.source&&old.managedPlugin.capabilityId===capabilityId?old.managedPlugin:{source:user.source,capabilityId,locations:[]},cwd,scope);return syncOne(store,user,id,source,deleteData);});
}
export async function syncOrganizationAutomations(user:User,cwd?:string){
  const store=storeFor(user);return locked(store,async()=>{
    const sources=new Map<string,ManagedAutomationPlugin>();
    for(const app of (await store.list()).apps)if(app.managedPlugin&&app.managedPlugin.source===user.source)sources.set(app.id,app.managedPlugin);
    for(const scope of ["global",...(cwd?["project" as const]:[])] as const){const directory=cwd??getAgentDir();for(const item of readHazeRegistry(directory,scope).installs){const app=item.plugin?.manifest.automation;if(item.type!=="Plugin"||item.plugin?.source!==user.source||!app)continue;const previous=sources.get(app.id);if(previous&&previous.capabilityId!==item.capabilityId)throw new AutomationAppError("不同插件声明了相同自动化应用 ID。",409);sources.set(app.id,addLocation(previous??{source:user.source,capabilityId:item.capabilityId,locations:[]},directory,scope));}}
    for(const [id,source] of sources)await syncOne(store,user,id,source);
  });
}
