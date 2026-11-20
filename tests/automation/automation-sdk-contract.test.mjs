import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createJiti } from "jiti";
const {assertSdkContract,sdkContractSummary}=await createJiti(import.meta.url).import("../../features/automation/sdk/automation-sdk-contract.ts");
const fixtures=JSON.parse(await readFile(new URL('../../features/automation/sdk/automation-sdk-contract-fixtures.json',import.meta.url),'utf8'));
test("the shipped Haze contract is byte-identical to the host source",async()=>{
 const source=await readFile(new URL('../../features/automation/sdk/automation-sdk-contract.json',import.meta.url));assert.deepEqual(await readFile(new URL('../../integrations/haze/automation-sdk-contract.json',import.meta.url)),source);assert.equal(sdkContractSummary().limits.downloadBytes,1024*1024*1024);
});
test("portable capability fixtures enforce field/type compatibility",()=>{for(const [definition,value,valid]of fixtures){let actual=true;try{assertSdkContract(definition,value);}catch{actual=false;}assert.equal(actual,valid,JSON.stringify([definition,value]));}});
test("Haze Python and Eureka Node agree on the same capability fixtures",t=>{
 const python=process.env.PYTHON??'python',env={...process.env,PYTHONPATH:[resolve('.tmp/python-sdk-deps'),process.env.PYTHONPATH].filter(Boolean).join(process.platform==='win32'?';':':')};
 const probe=spawnSync(python,['-c','import jsonschema'],{env,encoding:'utf8'});if(probe.status!==0){t.skip('Install integrations/haze/requirements.txt to run cross-language contract parity');return;}
 const script="import sys,json;sys.path.insert(0,'integrations/haze');from eureka_sdk_validator import validate_declaration;print(json.dumps([not validate_declaration(x[0],x[1]) for x in json.load(sys.stdin)]))";
 const response=spawnSync(python,['-c',script],{env,encoding:'utf8',input:JSON.stringify(fixtures)});assert.equal(response.status,0,response.stderr);assert.deepEqual(JSON.parse(response.stdout),fixtures.map(f=>f[2]));
});
