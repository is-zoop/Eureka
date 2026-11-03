import { inspectAutomationFiles, writeAutomationAppZip } from "./automation-app-package";
import type { AppBrowserSite } from "./automation-app-browser";

/** New immutable fixtures; do not change A02/A03 package identities or bytes. */
export function browserAutomationExample(kind: "queries" | "operations", version = "1.0.0") {
  if (!["1.0.0","1.1.0"].includes(version)) throw new Error("示例版本不存在");
  const writing=kind==="operations", name=writing?"browser-operation-example":"browser-fields-example";
  const root="http://127.0.0.1:8080/automation-app-demo.html", json=(value:unknown)=>JSON.stringify(value,null,2)+"\n";
  const account={locator:{css:"#account"},type:"text" as const,optional:true};
  const sites:AppBrowserSite[]=writing?[{id:"settings",label:"模拟网页选项",startUrl:root+"?view=operations",paths:["/automation-app-demo.html"],account,operations:[{id:"enable",label:"调整演示选项",description:"将当前模拟账号的演示选项设为配置中的勾选值；不改变任何真实业务。",kind:"check",effect:"mutation",locator:{css:"#enabled"},verify:{field:{locator:{css:"#enabled"},source:"checked",type:"boolean"},mode:"equals",input:true}}]}]:["products","marketing"].map((id):AppBrowserSite=>({id,label:id==="products"?"模拟商品字段":"模拟营销字段",startUrl:root+"?view="+id,paths:["/automation-app-demo.html"],account,operations:[{id:"fill",label:"填写查询标识",description:"填写查询输入框",effect:"query",kind:"fill",locator:{label:"查询标识"}},{id:"search",label:"查询",description:"按输入标识读取模拟记录",effect:"query",kind:"click",locator:{role:"button",name:"查询"}}]}));
  const nodes=writing?[{id:"connect",label:"连接并核对账号",kind:"browser"},{id:"change",label:"确认范围并修改选项",kind:"browser"},{id:"read",label:"读取页面状态",kind:"browser"}]:[{id:"connect",label:"连接并核对账号",kind:"browser"},{id:"query",label:"执行查询",kind:"browser"},{id:"read",label:"提取所需字段",kind:"browser"},{id:"output",label:"生成结果产物",kind:"script"}];
  const script=writing?`export default async function run(ctx) {
  await ctx.step("connect", null, () => ctx.browser.connect("settings"));
  await ctx.step("change", {enabled:ctx.params.enabled}, () => ctx.browser.operation("enable", {value:ctx.params.enabled}));
  const value=await ctx.step("read", null, () => ctx.browser.read({locator:{css:"#enabled"},source:"checked",type:"boolean"}));
  return [{enabled:value}];
}\n`:`export default async function run(ctx) {
  const site=ctx.params.page;
  if (!["products","marketing"].includes(site)) throw new Error("页面请选择 products 或 marketing。");
  await ctx.step("connect", {site}, () => ctx.browser.connect(site));
  await ctx.step("query", {identifiers:ctx.params.identifiers}, async()=>{
    await ctx.browser.operation("fill", {value:ctx.params.identifiers});
    await ctx.browser.operation("search");
    return ctx.browser.waitFor({locator:{css:"#query-state"},type:"text"},"完成："+ctx.params.identifiers.trim());
  });
  const field=(name,type="text",optional=false)=>({locator:{css:'[data-field="'+name+'"]'},type,optional});
  const fields=site==="products"?{id:field("id"),title:field("title"),price:field("price","number"),stock:field("stock","number"),sales:field("sales","number")}:{id:field("id"),title:field("title"),campaignId:field("campaignId"),fee:field("fee","percentage"),date:field("date","date"),tags:field("tags","list"),extra:field("extra","object"),optional:field("optional","number",true)};
  const rows=await ctx.step("read", {site,fields:Object.keys(fields)}, () => ctx.browser.extract({rows:{css:"#rows tr"},fields,limit:100}));
  await ctx.step("output", {count:rows.length},()=>ctx.artifacts.write("查询结果.json",JSON.stringify(rows,null,2),"application/json"));
  return rows;
}\n`;
  const published=["plugin.json","package.json","ui.json","workflow.json","scripts/main.mjs","README.md"];
  const files=new Map(Object.entries({
    "plugin.json":json({$schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",name,version,description:"A04 本机模拟网页验收；使用与真实网页相同的通用 SDK，不连接真实业务。",extensions:{"com.eureka":{schemaVersion:1,displayName:writing?"网页选项操作（模拟）":"多页面字段查询（模拟）",automation:{schemaVersion:1,id:writing?"58fd9e8a-3cc6-44cf-baad-12c782d92980":"3541b567-2f0e-4847-b186-42a8ec9a9c0d",runtime:"javascript-esm",entry:"scripts/main.mjs",ui:"ui.json",workflow:"workflow.json",capabilities:writing?["browser.read","browser.write"]:["browser.read","artifacts"],files:published,browser:{schemaVersion:1,sites}}}}}),
    "package.json":json({name,version,type:"module"}),
    "ui.json":json({schemaVersion:1,fields:writing?[{id:"enabled",label:"启用演示选项",type:"boolean",required:true,default:true}]:[{id:"page",label:"页面（products 或 marketing）",type:"text",required:true,default:"products"},{id:"identifiers",label:"查询标识（逗号分隔）",type:"text",required:true,default:"DEMO-001,DEMO-002"}],buttons:[{id:"run",label:writing?"设置并校验":"查询并提取",action:"run"}],results:{columns:writing?[{key:"enabled",label:"当前勾选值",type:"boolean"}]:[{key:"id",label:"标识",type:"text"},{key:"title",label:"名称",type:"text"},{key:"price",label:"价格（商品页）",type:"number"},{key:"stock",label:"库存（商品页）",type:"number"},{key:"fee",label:"费率（营销页，百分数）",type:"percentage"},{key:"campaignId",label:"营销编号",type:"text"},{key:"date",label:"日期",type:"date"},{key:"tags",label:"标签列表",type:"list"},{key:"extra",label:"附加对象",type:"object"},{key:"optional",label:"可空字段",type:"number"}],download:true}}),
    "workflow.json":json({schemaVersion:1,nodes,edges:nodes.slice(1).map((node,i)=>({from:nodes[i].id,to:node.id}))}),
    "scripts/main.mjs":script,
    "README.md":`# ${writing?"网页选项操作":"多页面字段查询"}（模拟）\n\n版本 ${version}；请在开发服务和重新编译后的 Eureka 桌面程序中使用。首次打开若等待登录，在右侧选择模拟账号后点击澄清卡片继续。${writing?"首次网页变更需要确认范围，授权绑定代码、网站、模拟账号和浏览环境；更换任一项会重新确认。1.1.0 用于验证代码版本变更重新授权。":"切换 page 参数可读取完全不同的商品或营销字段；示例标识 DEMO-001、DEMO-002。未适用列为空，不把空值填成零。"}\n\n所有业务数据为公开模拟，真实用户授权、账号、日志与结果只由宿主保存在 app-data 内，不进入本包。\n`,
  }).map(([file,value])=>[file,Buffer.from(value)]));
  inspectAutomationFiles(files);return writeAutomationAppZip(files);
}
