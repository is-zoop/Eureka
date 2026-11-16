import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import ts from "typescript";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {automationSdkIndex,automationSdkSection,renderAutomationSdkReference}=await jiti.import("./automation-sdk-reference.ts");
const {AUTOMATION_WORKER_SOURCE}=await jiti.import("./automation-app-worker.ts");

test("the reference covers every runtime SDK function actually exposed by the worker",()=>{
  const tree=ts.createSourceFile("worker.mjs",AUTOMATION_WORKER_SOURCE,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length,0);
  const declarations=new Map();
  const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)declarations.set(node.name.text,node.initializer);ts.forEachChild(node,visit);};visit(tree);
  const methods=[];
  const inspect=(expression,prefix)=>{
    if(ts.isCallExpression(expression)&&expression.expression.getText(tree)==="Object.freeze")return inspect(expression.arguments[0],prefix);
    if(ts.isArrowFunction(expression)||ts.isFunctionExpression(expression)){methods.push(prefix);return;}
    if(!ts.isObjectLiteralExpression(expression))return;
    for(const property of expression.properties){
      if(!ts.isPropertyAssignment(property)&&!ts.isShorthandPropertyAssignment(property))continue;
      const key=property.name.text;
      const value=ts.isShorthandPropertyAssignment(property)?declarations.get(key):property.initializer;
      if(value)inspect(value,`${prefix}.${key}`);
    }
  };
  inspect(declarations.get("ctx"),"ctx");
  const documented=automationSdkIndex().flatMap(({id})=>automationSdkSection(id).methods);
  assert.ok(methods.length>25);
  assert.equal(new Set(documented).size,documented.length,"a method belongs to one chapter");
  assert.deepEqual(documented.sort(),methods.sort());
});

test("the repository manual and chapter reads use identical reference content",async()=>{
  const index=automationSdkIndex();assert.equal(new Set(index.map(section=>section.id)).size,index.length);
  assert.equal(await readFile(new URL("../docs/automation-sdk-reference.md",import.meta.url),"utf8"),renderAutomationSdkReference());
  for(const item of index){
    const chapter=automationSdkSection(item.id);
    assert.equal(chapter.title,item.title);assert.ok(chapter.content.length>200);
    for(const source of chapter.sources)await access(new URL(`../${source}`,import.meta.url));
  }
  assert.throws(()=>automationSdkSection("unknown"),/SDK 章节无效/);
});

test("the AI chapter provides complete classifier files accepted by the actual rule parser", async () => {
  const { parseAppAiRules } = await jiti.import("./automation-app-ai.ts");
  const chapter = automationSdkSection("ai").content;
  const examples = [...chapter.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
  assert.equal(examples.length, 3);
  const types = [];
  for (const example of examples) {
    const rules = parseAppAiRules(Buffer.from(JSON.stringify(example)));
    const rule = Object.values(rules)[0];
    assert.equal(rule.operation, "classify");
    assert.equal(rule.output.type, { bool: "boolean", choice: "text", score: "number" }[rule.classifier.type]);
    types.push(rule.classifier.type);
  }
  assert.deepEqual(types.sort(), ["bool", "choice", "score"]);
});

test("the minimal documented entry uses real SDK methods and preserves line splitting",async()=>{
  const chapter=automationSdkSection("recipe").content;
  const code=chapter.match(/```js\n([\s\S]*?)\n```/)[1];
  const exampleModule=await import(`data:text/javascript,${encodeURIComponent(code)}`);
  const artifacts=[];
  const ctx={params:{text:"first\r\nsecond\n\n"},step:async(_id,_input,work)=>work(),artifacts:{write:async(name,text,mediaType)=>{artifacts.push({name,text,mediaType});return{id:"fixture-output"};}}};
  const rows=await exampleModule.default(ctx);
  assert.deepEqual(rows,[{index:1,value:"first"},{index:2,value:"second"}]);
  assert.equal(artifacts[0].mediaType,"application/json");assert.deepEqual(JSON.parse(artifacts[0].text),rows);
});

test("declared capabilities and per-action inheritance match the documented preflight rules",async()=>{
  const {APP_CAPABILITIES}=await jiti.import("./automation-app.ts");
  const overview=automationSdkSection("overview").content;
  for(const capability of APP_CAPABILITIES)assert.ok(overview.includes(`| ${capability} |`));
  const {multiActionAutomationFixture}=await jiti.import("./test-fixtures/automation-multi-actions.ts");
  const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
  const {appActionDetail}=await jiti.import("./automation-app-actions.ts");
  const {authorCheckPlan}=await jiti.import("./automation-authoring-validation.ts");
  const files=parseAutomationAppArchive(multiActionAutomationFixture()).files;
  const manifest=JSON.parse(files.get("plugin.json"));
  const declaration=manifest.extensions["com.eureka"].automation;
  declaration.capabilities=["files.read","files.write"];
  declaration.actions[0].capabilities=["files.read"];
  delete declaration.actions[1].capabilities;
  files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  const pkg=inspectAutomationFiles(files),checks=[{source:"result",path:"",expected:[]}];
  const query=appActionDetail(pkg,"count"),inherited=appActionDetail(pkg,"uppercase");
  assert.deepEqual(query.manifest.automation.capabilities,["files.read"]);
  assert.deepEqual(inherited.manifest.automation.capabilities,["files.read","files.write"]);
  assert.equal(authorCheckPlan(query,checks,[]).ready,true);
  assert.equal(authorCheckPlan(inherited,checks,[]).ready,false);
  assert.ok(authorCheckPlan(inherited,checks,[]).blocking.some(message=>message.includes("文件写入")));
});
