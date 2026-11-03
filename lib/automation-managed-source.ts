import { isAbsolute } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ManagedAutomationPlugin } from "./automation-app";
import { AutomationAppError } from "./automation-app-package";
import { readHazeRegistry } from "./haze-registry";
import { compareAppVersions } from "./automation-app-version";
import { getProjectTrustStatus } from "./project-trust";

export function parseManagedAutomationSource(raw:unknown):ManagedAutomationPlugin {
  const value=raw as ManagedAutomationPlugin;
  if(!value||typeof value.source!=="string"||!/^https?:\/\//.test(value.source)||typeof value.capabilityId!=="string"||!/^\d+$/.test(value.capabilityId)||!Array.isArray(value.locations)||!value.locations.length||value.locations.length>64||value.locations.some(location=>!location||!["global","project"].includes(location.scope)||typeof location.cwd!=="string"||!isAbsolute(location.cwd)))throw new AutomationAppError("组织插件来源登记无效",409);
  return {source:value.source,capabilityId:value.capabilityId,locations:value.locations.map(location=>({scope:location.scope,cwd:location.cwd}))};
}
/** Registry state is authoritative even if an automation projection is stale. */
export function managedAutomationState(id:string,raw:ManagedAutomationPlugin) {
  const source=parseManagedAutomationSource(raw);
  const candidates=source.locations.flatMap(location=>{
    const item=readHazeRegistry(location.cwd,location.scope).installs.find(item=>item.type==="Plugin"&&item.scope===location.scope&&item.capabilityId===source.capabilityId&&item.plugin?.source===source.source&&item.plugin.manifest.automation?.id===id);
    if(!item?.plugin?.manifest.automation)return [];
    const trusted=location.scope==="global"||getProjectTrustStatus(location.cwd,getAgentDir()).trusted;
    return [{location,item,disabled:Boolean(item.disabled)||!trusted}];
  }).sort((a,b)=>compareAppVersions(b.item.version,a.item.version));
  const versions=new Map<string,string>();
  for(const candidate of candidates){const digest=candidate.item.plugin!.manifest.automation!.digest;if(!/^[a-f0-9]{64}$/.test(digest)||versions.has(candidate.item.version)&&versions.get(candidate.item.version)!==digest)throw new AutomationAppError("同版本的组织自动化代码不一致，请增加版本号后重新发布。",409);versions.set(candidate.item.version,digest);}
  if(new Set(candidates.map(candidate=>candidate.item.plugin!.manifest.name)).size>1)throw new AutomationAppError("组织自动化应用身份不一致。",409);
  const selected=candidates.find(candidate=>!candidate.disabled)??candidates[0];
  return {source,candidates,selected,disabled:!candidates.some(candidate=>!candidate.disabled)};
}
export function assertManagedAutomationEnabled(id:string,source:ManagedAutomationPlugin) {
  const state=managedAutomationState(id,source);
  if(!state.selected)throw new AutomationAppError("所属组织插件已卸载，运行已中断。",409);
  if(state.disabled)throw new AutomationAppError("所属组织插件已停用或项目未受信任，运行已中断。",409);
}
