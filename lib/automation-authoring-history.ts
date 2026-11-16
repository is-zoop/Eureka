import type { AgentMessage } from "@earendil-works/pi-agent-core";

const retired=new Set(["eureka_app_test","eureka_app_validate"]);
/** Provider-only projection. Never edits JSONL, UI history or private run data. */
export function projectAuthoringHistory(messages:AgentMessage[]):AgentMessage[]{
  const receipts=messages.filter(m=>m.role==="toolResult");
  const completed=new Set(receipts.map(m=>m.toolCallId));
  const failed=new Set(receipts.filter(m=>m.isError).map(m=>m.toolCallId));
  let lastSuccessfulWrite=-1;
  messages.forEach((message,index)=>{if(message.role==="assistant"&&message.content.some(b=>b.type==="toolCall"&&b.name==="eureka_app_write"&&completed.has(b.id)&&!failed.has(b.id)))lastSuccessfulWrite=index;});
  return messages.map<AgentMessage>((message,messageIndex)=>{
    if(message.role==="assistant"){
      const content=message.content.map<(typeof message.content)[number]>(block=>{
        if(block.type!=="toolCall"||!completed.has(block.id))return block;
        if(block.thoughtSignature)return block;
        if(retired.has(block.name))return {...block,arguments:{manualTestingOnly:true}};
        if(block.name!=="eureka_app_write")return block;
        // Until a valid package exists, keep the failed attempt available for
        // correction. It may be the only copy of a new application's source.
        if(failed.has(block.id)&&messageIndex>lastSuccessfulWrite)return block;
        const a=block.arguments,files=a.files&&typeof a.files==="object"&&!Array.isArray(a.files)?Object.fromEntries(Object.keys(a.files).map(name=>[name,"[历史源码已省略；按任务文件索引读取当前代码]"])):undefined;
        if(a.historicalWrite===true)return block;
        return {...block,arguments:{historicalWrite:true,...(typeof a.baseDigest==="string"?{baseDigest:a.baseDigest}:{}),...(files?{files}:{}),...(Array.isArray(a.edits)?{editedFiles:a.edits.map(e=>e&&typeof e==="object"&&typeof (e as {path?:unknown}).path==="string"?String((e as {path:string}).path):null)}:{})}};
      });
      return {...message,content};
    }
    if(message.role!=="toolResult")return message;
    if(retired.has(message.toolName))return {...message,content:[{type:"text",text:"历史 AI 试运行/校验内容不进入模型上下文。测试仅由用户人工运行，结果保留在应用界面。"}],details:undefined};
    const text=message.content.filter(b=>b.type==="text").map(b=>b.text).join("\n");
    let parsed:Record<string,unknown>;
    try{const value:unknown=JSON.parse(text);if(!value||typeof value!=="object"||Array.isArray(value))return message;parsed=value as Record<string,unknown>;}catch{return message;}
    if(message.toolName==="eureka_automation_task"&&(parsed.sdk||parsed.state||parsed.baseFiles||parsed.candidateFiles)){
      const state=parsed.state as {candidate?:{digest?:string;id?:string}}|undefined;
      const files=parsed.candidateFiles??parsed.baseFiles;
      const summary={historicalTask:true,suggestedAppId:parsed.suggestedAppId,digest:state?.candidate?.digest,files:files&&typeof files==="object"?Object.keys(files):[],message:"历史整包、SDK 和运行状态已省略；读取当前任务摘要与所需文件。"};
      return {...message,content:[{type:"text",text:JSON.stringify(summary)}],details:undefined};
    }
    if(["eureka_app_browser","eureka_app_file"].includes(message.toolName)&&Buffer.byteLength(text)>24000){
      return {...message,content:[{type:"text",text:JSON.stringify({historicalExploration:true,evidenceId:parsed.evidenceId,message:"历史探索正文已省略；需要具体字段时按 evidenceId 分页读取。"})}],details:undefined};
    }
    return message;
  });
}
