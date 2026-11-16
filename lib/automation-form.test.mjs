import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {relativeAppDate,appFieldDefault,seedAppForm,parseAppFormLayout,appFormFields}=await jiti.import("./automation-form.ts");
const {appParameters}=await jiti.import("./automation-app-run.ts");
const {inspectAutomationFiles}=await jiti.import("./automation-app-package.ts");
const {automationExampleFiles}=await jiti.import("./automation-app-example.ts");
const {appBrowserEnvironment}=await jiti.import("./automation-app-browser.ts");

test("relative dates use local calendar arithmetic across leap days and year boundaries",()=>{
  assert.equal(relativeAppDate("yesterday",new Date(2026,0,1,0,5)),"2025-12-31");
  assert.equal(relativeAppDate("yesterday",new Date(2024,2,1,12)),"2024-02-29");
  assert.equal(relativeAppDate("tomorrow",new Date(2026,11,31,12)),"2027-01-01");
  assert.equal(relativeAppDate("today",new Date(2026,10,12,0,1)),"2026-11-12");
});
test("activation uses SDK date defaults and preserves other saved values",()=>{
  const ui={fields:[{id:"date",type:"date",default:{relative:"yesterday"}},{id:"name",type:"text",default:"original"}]};
  const saved={date:"2020-01-01",name:"saved"};
  assert.deepEqual(seedAppForm(ui,saved,new Date(2026,0,1,12)),{date:"2025-12-31",name:"saved"});
  const fixed={fields:[{id:"date",type:"date",default:"2026-01-02"}]};
  assert.equal(seedAppForm(fixed,{date:saved.date},new Date(2026,0,1,12)).date,saved.date);
  assert.equal(seedAppForm(fixed,{},new Date(2026,0,1,12)).date,"2026-01-02");
  assert.equal(appFieldDefault(ui.fields[0],new Date(2026,0,1,12)),"2025-12-31");
  assert.match(appParameters(ui,{},true).date,/^\d{4}-\d{2}-\d{2}$/);
});
test("layout validates field identity and widths while preserving undeclared field order",()=>{
  const ui={fields:[{id:"a"},{id:"b"},{id:"c"}]};
  const layout=parseAppFormLayout({columns:3,order:["c"],spans:{a:2}},["a","b","c"]);
  assert.deepEqual(appFormFields(ui,layout).map(field=>field.id),["c","a","b"]);
  assert.deepEqual(ui.fields.map(field=>field.id),["a","b","c"]);
  for(const raw of [{columns:0},{columns:5},{columns:2,order:["a","a"]},{columns:2,order:["unknown"]},{columns:2,spans:{a:3}},{columns:2,spans:{unknown:1}}])assert.throws(()=>parseAppFormLayout(raw,["a","b","c"]));
});
test("SDK package accepts layouts and relative dates and rejects invalid defaults",()=>{
  function inspect(relative="yesterday",layout={columns:3,order:["date","source"],spans:{date:2}}){
    const files=automationExampleFiles(),ui=JSON.parse(files.get("ui.json"));
    ui.fields.push({id:"date",label:"Date",type:"date",default:{relative}});ui.layout=layout;
    files.set("ui.json",Buffer.from(JSON.stringify(ui)));return inspectAutomationFiles(files);
  }
  const pkg=inspect();assert.equal(pkg.ui.layout.columns,3);assert.deepEqual(pkg.ui.fields.at(-1).default,{relative:"yesterday"});
  assert.throws(()=>inspect("last-week"));assert.throws(()=>inspect("today",{columns:2,spans:{date:3}}));
});
test("default browser environment is persistent and shared across application sites",()=>{
  assert.equal(appBrowserEnvironment({},"first"),"00000000000000000000000000000000");
  assert.equal(appBrowserEnvironment({},"first"),appBrowserEnvironment({},"second"));
  assert.equal(appBrowserEnvironment({first:"a".repeat(32)},"first"),"a".repeat(32));
  assert.equal(appBrowserEnvironment({first:"temporary"},"first"),"temporary");
});
