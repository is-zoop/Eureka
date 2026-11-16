import { writeAutomationAppZip } from "../automation-app-package";

/** Test-only fixture. Never imported by application routes or exposed as a download. */
export function multiActionAutomationFixture(): Buffer {
  const fields = [{ id: "text", label: "文本", type: "text", required: true, multiline:true }];
  const ui = (id:string,label:string,columns:{key:string;label:string;type:string}[]) => ({schemaVersion:1,fields,buttons:[{id,label,action:"run"}],results:{columns,download:true}});
  const graph = (labels:string[]) => ({schemaVersion:1,nodes:labels.map((label,i)=>({id:`step${i+1}`,label,kind:"script"})),edges:labels.slice(1).map((_,i)=>({from:`step${i+1}`,to:`step${i+2}`}))});
  const files = new Map<string,Buffer>();
  const put = (name:string,value:unknown) => files.set(name,Buffer.from(JSON.stringify(value,null,2)+"\n"));
  put("package.json",{name:"text-functions-example",version:"1.0.0",type:"module"});
  put("ui.json",ui("count","统计字数",[{key:"characters",label:"字符数",type:"number"},{key:"lines",label:"行数",type:"number"}]));
  put("workflow.json",graph(["读取文本","统计并返回结果"]));
  put("ui/uppercase.json",ui("uppercase","转为大写",[{key:"output",label:"转换结果",type:"text"}]));
  put("workflows/uppercase.json",graph(["读取文本","转换为大写","返回结果"]));
  put("ui/dedupe.json",ui("dedupe","逐行去重",[{key:"value",label:"保留内容",type:"text"}]));
  put("workflows/dedupe.json",graph(["读取文本","拆分非空行","保留首次出现","返回去重结果"]));
  files.set("scripts/count.mjs",Buffer.from('export default async ctx => { const text=await ctx.step("step1",{text:ctx.params.text},async()=>ctx.params.text); return ctx.step("step2",null,async()=>[{characters:Array.from(text).length,lines:text.split(/\\r?\\n/).length}]); };\n'));
  files.set("scripts/uppercase.mjs",Buffer.from('export default async ctx => { const text=await ctx.step("step1",{text:ctx.params.text},async()=>ctx.params.text); const output=await ctx.step("step2",null,async()=>text.toUpperCase()); return ctx.step("step3",null,async()=>[{output}]); };\n'));
  files.set("scripts/dedupe.mjs",Buffer.from('export default async ctx => { const text=await ctx.step("step1",{text:ctx.params.text},async()=>ctx.params.text); const lines=await ctx.step("step2",null,async()=>text.split(/\\r?\\n/).filter(Boolean)); const values=await ctx.step("step3",null,async()=>[...new Set(lines)]); return ctx.step("step4",null,async()=>values.map(value=>({value}))); };\n'));
  files.set("README.md",Buffer.from("# 文本处理工具箱\n\n三个独立功能：统计字数、转为大写、逐行去重。每个功能拥有自己的文本配置、入口、流程和结果列。无网络、无文件授权、无模型请求。运行不会自动生成导出文件。\n"));
  const published=["plugin.json",...files.keys()];
  put("plugin.json",{$schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",name:"text-functions-example",version:"1.0.0",description:"多功能自动化本地验收示例。",extensions:{"com.eureka":{schemaVersion:1,displayName:"文本处理工具箱",automation:{schemaVersion:1,id:"81b8a29b-4e6f-4ad9-bb50-debf9a485b66",runtime:"javascript-esm",entry:"scripts/count.mjs",ui:"ui.json",workflow:"workflow.json",capabilities:[],files:published,actions:[{id:"count",label:"统计字数",description:"统计字符与行数",entry:"scripts/count.mjs",ui:"ui.json",workflow:"workflow.json",capabilities:[]},{id:"uppercase",label:"转为大写",description:"转换英文字母大小写",entry:"scripts/uppercase.mjs",ui:"ui/uppercase.json",workflow:"workflows/uppercase.json",capabilities:[]},{id:"dedupe",label:"逐行去重",description:"保留每行首次出现的内容",entry:"scripts/dedupe.mjs",ui:"ui/dedupe.json",workflow:"workflows/dedupe.json",capabilities:[]}]}}}});
  return writeAutomationAppZip(files);
}
