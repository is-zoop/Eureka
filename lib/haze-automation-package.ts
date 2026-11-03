import { parsePluginArchive,readPluginZip,type PluginArchive } from "./haze-plugin-package";
import { parseAutomationAppArchive,type AutomationAppPackage } from "./automation-app-package";

export type OrganizationPluginArchive=PluginArchive & {automation?:AutomationAppPackage};
/** Dispatch by the actual manifest, never the marketplace title or category. */
export function parseOrganizationPluginArchive(bytes:Buffer,expectedVersion:string):OrganizationPluginArchive {
  const entries=readPluginZip(bytes),roots=[...entries.keys()].filter(name=>name==="plugin.json"||/^[^/]+\/plugin\.json$/.test(name));
  if(roots.length!==1)throw new Error("插件包必须包含唯一的 plugin.json。");
  const manifestBytes=entries.get(roots[0])!;if(manifestBytes.length>1024*1024)throw new Error("插件清单过大。");
  const raw=JSON.parse(manifestBytes.toString("utf8")),host=raw?.extensions?.["com.eureka"];
  if(!host||!Object.hasOwn(host,"automation"))return parsePluginArchive(bytes,expectedVersion);
  // A malformed automation declaration cannot fall back to ordinary plugins.
  const automation=parseAutomationAppArchive(bytes);
  if(automation.manifest.version!==expectedVersion)throw new Error("Haze 与自动化应用包版本不一致，请重新准备安装。");
  return {files:automation.files,automation,manifest:{name:automation.manifest.name,version:expectedVersion,displayName:automation.manifest.displayName,skillDirectories:[],servers:[],automation:{id:automation.manifest.automation.id,digest:automation.digest,files:[...automation.files.keys()]}}};
}
