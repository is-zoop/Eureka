import { createHash } from "node:crypto";
import type { AutomationTaskRef } from "../shared/automation-mode";
import { authorAccess, authorEvidence, authorPackage, readAuthor, recoverAuthor } from "./automation-authoring";
import { automationSdkIndex, automationSdkSection } from "../sdk/automation-sdk-reference";
import { mergeSourcePaths } from "./automation-authoring-source";
import { automationPublishPath } from "../runtime/automation-app-package";
import type { AuthorValuePage } from "./automation-authoring-output";

export interface AuthorContextInput extends AuthorValuePage {sdkSection?:string;file?:string;source?:"current"|"base";search?:string;evidenceId?:string;fileOffset?:number}
/** Only code and explicit read-only exploration can be read by the authoring
 * model. Manual-run state, results, logs and captured trial evidence stay in UI. */
export async function authorContext(task:AutomationTaskRef,input:AuthorContextInput={}) {
  const a=await authorAccess(task);
  if([input.sdkSection,input.file,input.evidenceId].filter(v=>v!==undefined).length>1)throw new Error("每次仅选择 SDK 章节、代码文件或探索记录中的一项。");
  if(input.sdkSection!==undefined)return {sdkReference:automationSdkSection(input.sdkSection)};
  if(input.evidenceId!==undefined)return authorEvidence(task,input.evidenceId,input);
  await recoverAuthor(a);
  const state=await readAuthor(a),pkg=await authorPackage(a,input.source??"current");
  if(input.file!==undefined){
    const file=automationPublishPath(input.file),bytes=pkg?.files.get(file);
    if(!bytes)throw new Error("当前代码包中没有此文件。");
    if(/\.(png|jpe?g|webp|gif|ico)$/.test(file))throw new Error("二进制资源仅显示目录，不转成模型文本。");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes),offset=input.offset??0,limit=input.limit??8000;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>12000)throw new Error("代码读取范围无效。");
    let start=offset;
    if(input.search!==undefined){if(!input.search||input.search.length>2000)throw new Error("搜索文本无效。");const match=text.indexOf(input.search,offset);if(match<0)return {file,digest:pkg!.digest,found:false,totalChars:text.length};start=Math.max(offset,match-200);}
    let count=Math.min(limit,Math.max(0,text.length-start));
    while(Buffer.byteLength(JSON.stringify(text.slice(start,start+count)))>16000)count=Math.floor(count/2);
    if(count&&/[\uD800-\uDBFF]/.test(text.charAt(start+count-1)))count=count===1&&start+1<text.length?2:count-1;
    return {file,digest:pkg!.digest,fileHash:createHash("sha256").update(bytes).digest("hex"),offset:start,text:text.slice(start,start+count),totalChars:text.length,nextOffset:start+count<text.length?start+count:null};
  }
  const c=state.candidate,files=pkg?[...pkg.files].map(([path,bytes])=>({path,bytes:bytes.length,hash:createHash("sha256").update(bytes).digest("hex")})):[];
  const offset=input.fileOffset??0;if(!Number.isSafeInteger(offset)||offset<0)throw new Error("文件目录分页无效。");
  return {task:a.task,sessionId:a.doc.sessionId,active:a.doc.status==="active",goal:a.doc.goal,displayName:state.displayName??pkg?.manifest.displayName,
    suggestedAppId:a.task.baseApp?.id??a.task.id,version:pkg?.manifest.version,digest:pkg?.digest,
    candidate:c?{id:c.id,digest:c.digest,revision:c.revision,saved:Boolean(c.saved),scope:c.scope.slice(0,10).map(s=>s.slice(0,200)),limitations:c.limitations.slice(0,10).map(s=>s.slice(0,200))}:null,
    files:files.slice(offset,offset+40),fileCount:files.length,nextFileOffset:offset+40<files.length?offset+40:null,
    sourcePaths:mergeSourcePaths(a.doc.sourcePaths??[],a.doc.goal),sdkSections:automationSdkIndex(),testing:"manual-only",
    editing:"使用当前 digest 作为 baseDigest；files 只传变更文件，或使用 edits 唯一文本替换。版本号可保持不变。"};
}
