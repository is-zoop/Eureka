import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {projectAuthoringHistory}=await jiti.import("../../features/automation/authoring/automation-authoring-history.ts");
const {authorValuePage}=await jiti.import("../../features/automation/authoring/automation-authoring-output.ts");
const {editAuthorPackage}=await jiti.import("../../features/automation/authoring/automation-authoring-edit.ts");
const {fileAutomationExample}=await jiti.import("../../features/automation/runtime/automation-app-example.ts");
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("../../features/automation/runtime/automation-app-package.ts");

test("provider projection isolates legacy trials and repeated source without changing persisted history or call pairing",()=>{
  const privateValue="private-trial-data",source="source-body".repeat(5000);
  const reply=(toolName,toolCallId,value)=>({role:"toolResult",toolName,toolCallId,content:[{type:"text",text:JSON.stringify(value)}],details:{privateValue},isError:false,timestamp:1});
  const messages=[{role:"user",content:"Keep the user's requirement",timestamp:1},{role:"assistant",content:[
    {type:"toolCall",name:"eureka_app_test",id:"trial",arguments:{values:{privateValue}}},
    {type:"toolCall",name:"eureka_app_write",id:"write",arguments:{files:{"scripts/main.mjs":source},checks:[{expected:privateValue}]}}
  ]},reply("eureka_app_test","trial",{result:privateValue,evidence:[privateValue]}),reply("eureka_app_write","write",{generated:true,digest:"a"}),reply("eureka_automation_task","task",{sdk:source,baseFiles:{"main.mjs":source},state:{evidence:[privateValue],candidate:{digest:"a"}}}),reply("eureka_app_browser","browser",{evidenceId:"read-only",value:source})];
  const original=JSON.stringify(messages),projected=projectAuthoringHistory(messages);
  assert.equal(JSON.stringify(messages),original,"the actual transcript/UI remains intact");
  assert.deepEqual(projectAuthoringHistory(projected),projected,"repeated SDK projection is stable");
  assert.equal(projected[0].content,messages[0].content);
  assert.deepEqual(projected.filter(m=>m.role==="toolResult").map(m=>[m.toolName,m.toolCallId]),messages.filter(m=>m.role==="toolResult").map(m=>[m.toolName,m.toolCallId]));
  // A normal write receipt can retain metadata details; trial/task/browser bodies cannot.
  assert.equal(projected[2].details,undefined);assert.equal(projected[4].details,undefined);
  assert.equal(JSON.stringify(projected.map(m=>m.content)).includes(privateValue),false);
  assert.ok(JSON.stringify(projected).length<original.length/10);
  const pending={role:"assistant",content:[{type:"toolCall",name:"eureka_app_write",id:"pending",arguments:{files:{"main.mjs":source}}}]};
  assert.deepEqual(projectAuthoringHistory([pending])[0].content,pending.content,"an unfinished tool call must never be rewritten");
});

test("exploration pages preserve exact rows and fields while bounded views never masquerade as full values",()=>{
  const rows=Array.from({length:50},(_,i)=>({id:String(i).padStart(20,"0"),zero:0,enabled:false,large:"x".repeat(10000)}));
  const root=authorValuePage({rows},"ref");assert.equal(root.omitted,true);assert.equal(root.value,undefined);
  const page=authorValuePage({rows},"ref",{path:"/rows",fields:["id","zero","enabled"],offset:7,limit:5});
  assert.deepEqual(page.values,rows.slice(7,12).map(({id,zero,enabled})=>({id,zero,enabled})));assert.equal(page.nextOffset,12);assert.equal(page.total,50);
  assert.ok(Buffer.byteLength(JSON.stringify(authorValuePage(rows,"ref")))<24000);
  assert.throws(()=>authorValuePage(rows,"ref",{path:"/missing"}));
});

test("context projection retains uncommitted failed source for correction and leaves opaque signed calls intact",()=>{
  const attempt={role:"assistant",content:[{type:"toolCall",name:"eureka_app_write",id:"failed",arguments:{files:{"scripts/main.mjs":"the only generated source"}}}]};
  const failure={role:"toolResult",toolName:"eureka_app_write",toolCallId:"failed",isError:true,content:[{type:"text",text:"missing README"}],timestamp:1};
  assert.deepEqual(projectAuthoringHistory([attempt,failure])[0].content,attempt.content);
  const success={role:"assistant",content:[{type:"toolCall",name:"eureka_app_write",id:"fixed",arguments:{files:{"README.md":"done"}}}]};
  const receipt={...failure,toolCallId:"fixed",isError:false,content:[{type:"text",text:'{"generated":true}'}]};
  assert.equal(projectAuthoringHistory([attempt,failure,success,receipt])[0].content[0].arguments.historicalWrite,true);
  const signed={...success,content:[{...success.content[0],thoughtSignature:"opaque-provider-signature"}]};
  assert.deepEqual(projectAuthoringHistory([signed,receipt])[0].content,signed.content);
});

test("incremental edits retain binary assets and publish checks reject unsafe or incomplete merged packages",()=>{
  const files=parseAutomationAppArchive(fileAutomationExample()).files;
  files.set("assets/icon.png",Buffer.from([0,255,128,13]));
  const manifest=JSON.parse(files.get("plugin.json"));manifest.extensions["com.eureka"].automation.files.push("assets/icon.png");files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  const original=inspectAutomationFiles(files);
  const changed=editAuthorPackage(original,{"README.md":"# Edited\n"},{baseDigest:original.digest});
  assert.ok(changed.files.get("assets/icon.png").equals(files.get("assets/icon.png")));
  assert.equal(changed.manifest.version,original.manifest.version);
  assert.throws(()=>editAuthorPackage(original,{"../escape.mjs":"x"},{baseDigest:original.digest}));
  assert.throws(()=>editAuthorPackage(original,undefined,{baseDigest:original.digest,deleteFiles:["ui.json"]}));
  assert.throws(()=>editAuthorPackage(original,{"README.md":"changed"},{baseDigest:"wrong"}));
  assert.equal(original.files.get("README.md").equals(files.get("README.md")),true);
});
