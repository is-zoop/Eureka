import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { activeAutomationTask, assertAutomationTaskIdentity } from "../runtime/automation-mode-store";
import { AUTOMATION_AUTHOR_SYSTEM, AUTOMATION_AUTHOR_TOOLS } from "./automation-authoring-guide";
import { authorExplore, authorWrite, releaseAuthorBrowser, authorFile, authorSource } from "./automation-authoring";
import { authorContext, type AuthorContextInput } from "./automation-authoring-context";
import type { SourceReadInput } from "./automation-authoring-source";
import type { AuthorCheck } from "./automation-authoring-types";
import type { AuthorWriteOptions } from "./automation-authoring-edit";
import { projectAuthoringHistory } from "./automation-authoring-history";
const retired=["eureka_app_test","eureka_app_validate"];
const result=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],details:{automationAuthoring:true}});
export const EUREKA_AUTOMATION_INTAKE_EXTENSION: InlineExtension = { name: "eureka-automation-intake", hidden: true, factory: pi => {
  pi.on("context",event=>({messages:projectAuthoringHistory(event.messages)}));
  pi.on("before_agent_start", (_event, ctx) => {
    const task = activeAutomationTask(ctx.sessionManager);
    pi.setActiveTools(pi.getActiveTools().filter(name=>!retired.includes(name)));
    if(task){assertAutomationTaskIdentity(task.task);return {systemPrompt:AUTOMATION_AUTHOR_SYSTEM};}
    pi.setActiveTools(pi.getActiveTools().filter(name=>!AUTOMATION_AUTHOR_TOOLS.includes(name)||name==="request_user_input"));
  });
  pi.on("tool_call", async(event, ctx) => {
    if(retired.includes(event.toolName))return {block:true,reason:"自动化测试仅由用户在界面手动运行，模型试运行和模型校验已移除。",terminate:true};
    const task=activeAutomationTask(ctx.sessionManager);
    if(task){assertAutomationTaskIdentity(task.task);if(!AUTOMATION_AUTHOR_TOOLS.includes(event.toolName))return {block:true,reason:"创建仅开放任务代码修改和只读探索能力。",terminate:true};if(event.toolName==="request_user_input")await releaseAuthorBrowser(task.task);}
    else if(AUTOMATION_AUTHOR_TOOLS.includes(event.toolName)&&event.toolName!=="request_user_input")return {block:true,reason:"仅所属首页自动化任务可以使用创建能力。"};
  });
  pi.on("agent_end",async(_event,ctx)=>{const task=activeAutomationTask(ctx.sessionManager);if(task)await releaseAuthorBrowser(task.task).catch(()=>{});});
  const register=(name:string,label:string,description:string,parameters:ReturnType<typeof Type.Object>,work:(p:Record<string,unknown>,task:NonNullable<ReturnType<typeof activeAutomationTask>>,signal?:AbortSignal)=>Promise<unknown>)=>pi.registerTool({name,label,description,parameters,executionMode:"sequential",execute:async(_id,p,signal,_update,ctx)=>{const task=activeAutomationTask(ctx.sessionManager);if(!task)throw new Error("请先选择首页自动化命令。");assertAutomationTaskIdentity(task.task);signal?.throwIfAborted();return result(await work(p,task,signal));}});
  register("eureka_automation_task","读取任务摘要或指定代码","Default: lightweight task/digest/file index and SDK index only; no full code, full SDK, trial logs/results or trial evidence. sdkSection reads one SDK chapter. file reads CURRENT code by character offset/limit (or search); source:base explicitly selects the original package. evidenceId reads ONLY read-only exploration, with JSON Pointer path, fields and offset/limit. Manual runs are never accessible.",Type.Object({
    sdkSection:Type.Optional(Type.String({maxLength:40})),file:Type.Optional(Type.String({maxLength:240})),source:Type.Optional(Type.Union([Type.Literal("current"),Type.Literal("base")])),search:Type.Optional(Type.String({maxLength:2000})),evidenceId:Type.Optional(Type.String({maxLength:100})),path:Type.Optional(Type.String({maxLength:2000})),fields:Type.Optional(Type.Array(Type.String({maxLength:200}),{maxItems:32})),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:12000})),fileOffset:Type.Optional(Type.Integer({minimum:0}))
  }),async(p,t)=>authorContext(t.task,p as AuthorContextInput));
  register("eureka_app_browser","只读探索网页","Discover declared DOM/session API read operations. Never runs candidate code or business mutations. Large responses stay private; model receives a shape/page and evidenceId for on-demand reading.",Type.Object({method:Type.String(),args:Type.Array(Type.Any())}),async(p,t,signal)=>{if(!["open","observe","locate","read","extract","operation","request","navigate","release"].includes(String(p.method))||!Array.isArray(p.args))throw new Error("网页方法无效。");return authorExplore(t.task,String(p.method),p.args,signal);});
  register("eureka_app_file","读取已选择业务文件","Read an explicitly user-picked file/directory configuration with list/readText/readJson. No arbitrary paths or manual trial records. Large content is paged using its evidenceId.",Type.Object({fieldId:Type.String(),method:Type.String(),relative:Type.Optional(Type.String()),actionId:Type.Optional(Type.String())}),async(p,t)=>authorFile(t.task,String(p.fieldId),String(p.method),p.relative as string|undefined,p.actionId as string|undefined));
  register("eureka_app_source","读取原项目源码","Read-only paginated original source at paths supplied by the user in THIS task. Does not run code, grant runtime access or read trial results.",Type.Object({path:Type.String(),method:Type.Union([Type.Literal("list"),Type.Literal("readText"),Type.Literal("readJson")]),offset:Type.Optional(Type.Integer({minimum:1})),limit:Type.Optional(Type.Integer({minimum:1,maximum:300}))}),async(p,t,signal)=>authorSource(t.task,p as unknown as SourceReadInput,signal));
  register("eureka_app_write","增量修改应用代码","First creation: complete files. Existing draft or base: REQUIRED current baseDigest; files contains only changed/new files, edits:[{path,oldText,newText}] replaces one unique exact match, deleteFiles removes files. Unchanged files and binary assets remain. Host validates the merged package and synchronizes its file list. Keep version/ID/name; same-version local revisions are supported. Does not execute, test or save the app. No model checks are needed.",Type.Object({files:Type.Optional(Type.Record(Type.String(),Type.String())),baseDigest:Type.Optional(Type.String({pattern:"^[a-f0-9]{64}$"})),edits:Type.Optional(Type.Array(Type.Object({path:Type.String(),oldText:Type.String({minLength:1}),newText:Type.String()}),{maxItems:100})),deleteFiles:Type.Optional(Type.Array(Type.String(),{maxItems:256})),scope:Type.Optional(Type.Array(Type.String(),{maxItems:64})),limitations:Type.Optional(Type.Array(Type.String(),{maxItems:30}))}),async(p,t)=>authorWrite(t.task,p.files as Record<string,string>|undefined,p.scope as string[]|undefined,p.limitations as string[]|undefined,(p.checks??[]) as AuthorCheck[],p as AuthorWriteOptions));
} };
