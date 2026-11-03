// Sources only: user runs these checks; no browser/model/network is invoked here.
import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const jiti=createJiti(import.meta.url);
const {authorEqual,authorValueAt,authorBrowserTarget}=await jiti.import("./automation-authoring-types.ts");
const {authorCheckPlan,authorColumnCoverage,parseAuthorChecks,replaceAuthorChecks}=await jiti.import("./automation-authoring-validation.ts");
const {parseAppAiRules,checkAiShape}=await jiti.import("./automation-app-ai.ts");
const {parseAutomationTaskRef,AUTOMATION_INTAKE_TOOLS}=await jiti.import("./automation-mode.ts");
const {fileAutomationExample}=await jiti.import("./automation-app-example.ts");
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
const {withAutomationAppName}=await jiti.import("./automation-app-metadata.ts");
test("user display name changes only plugin title while preserving executable and permission files",()=>{
  const original=parseAutomationAppArchive(fileAutomationExample());
  const renamed=withAutomationAppName(original,"  我的文件工具  ");
  assert.equal(renamed.manifest.displayName,"我的文件工具");
  assert.notEqual(renamed.digest,original.digest);
  assert.equal(renamed.manifest.automation.id,original.manifest.automation.id);
  assert.equal(renamed.manifest.version,original.manifest.version);
  for(const [path,bytes] of original.files)if(path!=="plugin.json")assert.ok(bytes.equals(renamed.files.get(path)),path);
  const before=JSON.parse(original.files.get("plugin.json")),after=JSON.parse(renamed.files.get("plugin.json"));
  after.extensions["com.eureka"].displayName=before.extensions["com.eureka"].displayName;
  assert.deepEqual(after,before);
  assert.equal(withAutomationAppName(original,original.manifest.displayName),original);
  assert.equal(withAutomationAppName(original),original);
  for(const value of ["","  ","x".repeat(101),"bad\nname",null,{}])assert.throws(()=>withAutomationAppName(original,value));
});
test("deterministic checks distinguish missing, null, false, zero and long text IDs",()=>{
  const data={rows:[{id:"99999999999999999999",zero:0,flag:false,empty:null,"a/b":{"~key":["2026-10-31",10]}}]};
  assert.equal(authorValueAt(data,"/rows/0/id"),"99999999999999999999");
  assert.deepEqual(authorValueAt(data,"/rows/0/a~1b/~0key"),["2026-10-31",10]);
  assert.throws(()=>authorValueAt(data,"/rows/0/missing"));assert.throws(()=>authorValueAt(data,"$.rows"));
  assert.equal(authorEqual(null,0),false);assert.equal(authorEqual(false,0),false);assert.equal(authorEqual({}, {x:null}),false);
  assert.equal(authorEqual({b:[1,0],a:null},{a:null,b:[1,0]}),true);assert.equal(authorEqual(["A","B"],["B","A"]),false);
});
test("AI output shape enforces allowed values, required properties and list types",()=>{
  const rules=parseAppAiRules(Buffer.from(JSON.stringify({schemaVersion:1,rules:{classify:{instruction:"Classify input only",output:{type:"object",properties:{category:{type:"text",enum:["A","B"]},rows:{type:"list",items:{type:"number"}}}}}}})));
  assert.doesNotThrow(()=>checkAiShape({category:"A",rows:[0,1]},rules.classify.output));
  for(const v of [{category:"C",rows:[]},{category:"A"},{category:"A",rows:["0"]},{category:"A",rows:[],extra:true}])assert.throws(()=>checkAiShape(v,rules.classify.output));
  assert.throws(()=>parseAppAiRules(Buffer.from('{"schemaVersion":1,"rules":{"r":{"instruction":"x","output":{"type":"list"}}}}')));
});
test("AI declaration cannot install without a real rule definition; existing packages still parse",()=>{
  const pkg=parseAutomationAppArchive(fileAutomationExample());assert.ok(pkg.manifest.automation.capabilities.includes("files.read"));
  const manifest=JSON.parse(pkg.files.get("plugin.json"));manifest.extensions["com.eureka"].automation.capabilities.push("ai");pkg.files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  assert.throws(()=>inspectAutomationFiles(pkg.files),/rules/);
});
test("modification reference retains only identity/version and authoring excludes shell or repo writes",()=>{
  const task={id:"3541b567-2f0e-4847-b186-42a8ec9a9c0d",ownerKey:"a".repeat(64),runtimeId:"login",baseApp:{id:"847ccbf9-18d8-49ee-b581-092bb2473023",revision:2,version:"1.0.0"}};
  assert.deepEqual(parseAutomationTaskRef({...task,password:"private",goal:"private"}),task);
  assert.deepEqual(parseAutomationTaskRef({...task,baseApp:{...task.baseApp,password:"private"}}),task);
  assert.throws(()=>parseAutomationTaskRef({...task,baseApp:{...task.baseApp,revision:0}}));
  assert.ok(AUTOMATION_INTAKE_TOOLS.includes("eureka_app_write"));assert.ok(!AUTOMATION_INTAKE_TOOLS.some(n=>["bash","write","edit"].includes(n)));
});

test("completed candidate cannot steal the browser transport from the next explorer",()=>{
  const snapshot={active:true,state:{candidate:{id:"candidate",runId:"trial"},explorer:{run:{id:"explore",status:"running"},detail:{install:{id:"explorer"}}}},run:{id:"trial",status:"completed"}};
  assert.deepEqual(authorBrowserTarget(snapshot),{appId:"explorer",runId:"explore"});
  snapshot.run.status="running";
  assert.deepEqual(authorBrowserTarget(snapshot),{appId:"candidate",runId:"trial"});
  snapshot.run.status="waiting-browser";
  assert.deepEqual(authorBrowserTarget(snapshot),{appId:"candidate",runId:"trial"});
  snapshot.run.status="completed";snapshot.state.explorer.run.status="failed";
  assert.equal(authorBrowserTarget(snapshot),null);
  snapshot.state.explorer.run.status="waiting-user";
  assert.deepEqual(authorBrowserTarget(snapshot),{appId:"explorer",runId:"explore"});
  snapshot.active=false;assert.equal(authorBrowserTarget(snapshot),null);
  snapshot.active=true;snapshot.state.candidate.saved={id:"saved"};assert.equal(authorBrowserTarget(snapshot),null);
});

const checkDetail={ui:{fields:[{id:"source",type:"file"}],results:{columns:[{key:"id",label:"编号"},{key:"value",label:"数值"},{key:"queryStatus",label:"查询状态"}]}},manifest:{automation:{capabilities:["browser.read"]}}};
test("one row's status is not a complete field validation plan",()=>{
  const checks=[{source:"result",path:"/0/queryStatus",expected:"已提取"}];
  const plan=authorCheckPlan(checkDetail,checks,[]);
  assert.equal(plan.ready,false);assert.deepEqual(plan.missingColumns,["编号","数值"]);assert.equal(plan.needsWebEvidence,true);
  const root=[{source:"result",path:"",expected:[]}];
  assert.equal(authorCheckPlan(checkDetail,root,[]).ready,true);
  assert.equal(authorCheckPlan(checkDetail,[],[]).ready,false);
  const writeDetail=structuredClone(checkDetail);writeDetail.manifest.automation.capabilities=["files.write"];
  assert.equal(authorCheckPlan(writeDetail,root,[]).ready,false);
  assert.equal(authorCheckPlan(writeDetail,[...root,{source:"artifact",name:"out.json",expected:"[]"}],[]).ready,true);
});

test("column coverage separates missing checks from missing data in every row",()=>{
  const rows=[{id:"000123",value:0,queryStatus:"已提取"},{id:"000456",value:null,queryStatus:"未确认"}];
  const checks=[{source:"result",path:"/0",expected:rows[0]}];
  const missingRules=authorColumnCoverage(checkDetail,checks,rows);
  assert.ok(missingRules.every(item=>!item.equal&&item.reason==="missing-check"));
  assert.deepEqual(missingRules[0].rows,[1]);
  assert.ok(authorColumnCoverage(checkDetail,[{source:"result",path:"",expected:rows}],rows).every(item=>item.equal));
  const missing=structuredClone(rows);delete missing[1].value;
  assert.equal(authorColumnCoverage(checkDetail,checks,missing)[1].reason,"missing-field");
  assert.ok(authorColumnCoverage(checkDetail,[],[]).every(item=>!item.equal));
  assert.equal(authorEqual(rows[1].queryStatus,"已提取"),false);
});

test("repairing checks preserves candidate code, actual run and evidence; stale updates fail",()=>{
  const evidence=[{id:"host-read",method:"extract",value:[{id:"000123",value:0}]}];
  const candidate={id:"app",digest:"current",revision:9,runId:"real-run",scope:["read"],limitations:[],checks:[],lastError:"actual earlier error",validation:{status:"failed",runId:"real-run",digest:"current",checks:[]}};
  const before=structuredClone(candidate);
  const checks=[{source:"result",path:"/0/value",evidenceId:"host-read",evidencePath:"/0/value"}];
  replaceAuthorChecks(candidate,checkDetail,checks,evidence,{digest:"current",runId:"real-run"});
  const expected={...before,checks};delete expected.validation;
  assert.deepEqual(candidate,expected);
  // Removing validation really deletes it, rather than changing run/code identity.
  assert.equal(Object.hasOwn(candidate,"validation"),false);
  const repaired=structuredClone(candidate);
  for(const guard of [{digest:"old",runId:"real-run"},{digest:"current",runId:"old-run"}])assert.throws(()=>replaceAuthorChecks(candidate,checkDetail,checks,evidence,guard));
  assert.throws(()=>replaceAuthorChecks(candidate,checkDetail,[{...checks[0],evidenceId:"other-task"}],evidence,{digest:"current",runId:"real-run"}));
  assert.deepEqual(candidate,repaired);
  assert.equal(authorCheckPlan(checkDetail,checks,evidence).needsWebEvidence,false);
  assert.throws(()=>parseAuthorChecks([{source:"result",path:"/bad~path",expected:0}],checkDetail,[]));
  assert.throws(()=>parseAuthorChecks([{source:"file",fieldId:"not-selected",expected:""}],checkDetail,[]));
  assert.deepEqual(parseAuthorChecks([],checkDetail,[]),[]);
});
