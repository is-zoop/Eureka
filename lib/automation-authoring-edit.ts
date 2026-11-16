import { automationPublishPath, inspectAutomationFiles, type AutomationAppPackage } from "./automation-app-package";

export interface AuthorFileEdit {path:string;oldText:string;newText:string}
export interface AuthorWriteOptions {baseDigest?:string;edits?:AuthorFileEdit[];deleteFiles?:string[]}
/** Merge in memory and validate the whole package before any registry mutation. */
export function editAuthorPackage(base:AutomationAppPackage|undefined, files:Record<string,string>|undefined, options:AuthorWriteOptions) {
  if(base&&options.baseDigest!==base.digest)throw new Error("草稿摘要已变化或缺少 baseDigest，请先读取当前任务；未修改任何代码。");
  if(!base&&options.baseDigest!==undefined)throw new Error("没有可修改的基础代码包。");
  if(files!==undefined&&(!files||typeof files!=="object"||Array.isArray(files)||Object.values(files).some(v=>typeof v!=="string")))throw new Error("代码文件必须是相对路径到文本的对象。");
  const merged=new Map(base?.files??[]);
  for(const [name,text] of Object.entries(files??{}))merged.set(automationPublishPath(name),Buffer.from(text));
  if(options.edits&&(!Array.isArray(options.edits)||options.edits.length>100))throw new Error("文本修改最多 100 项。");
  for(const edit of options.edits??[]){
    const name=automationPublishPath(edit.path),bytes=merged.get(name);
    if(!bytes||typeof edit.oldText!=="string"||!edit.oldText||typeof edit.newText!=="string")throw new Error("文本修改需要已有文件、非空 oldText 和 newText。");
    let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Error("仅能对 UTF-8 文本执行替换。");}
    const start=text.indexOf(edit.oldText);
    if(start<0||text.indexOf(edit.oldText,start+1)!==-1)throw new Error(`文本修改必须唯一匹配：${name}；未写入任何更改。`);
    text=text.slice(0,start)+edit.newText+text.slice(start+edit.oldText.length);merged.set(name,Buffer.from(text));
  }
  if(options.deleteFiles&&(!Array.isArray(options.deleteFiles)||options.deleteFiles.length>256))throw new Error("删除文件清单无效。");
  for(const name of options.deleteFiles??[])if(!merged.delete(automationPublishPath(name)))throw new Error("待删除文件不存在。");
  if(base&&merged.has("plugin.json")){
    const manifest=JSON.parse(merged.get("plugin.json")!.toString("utf8")),declared=manifest.extensions?.["com.eureka"]?.automation?.files;
    if(!Array.isArray(declared))throw new Error("应用文件清单无效。");
    const names=[...merged.keys()];
    if(declared.length!==names.length||names.some(name=>!declared.includes(name))){manifest.extensions["com.eureka"].automation.files=names;merged.set("plugin.json",Buffer.from(JSON.stringify(manifest,null,2)+"\n"));}
  }
  return inspectAutomationFiles(merged);
}
