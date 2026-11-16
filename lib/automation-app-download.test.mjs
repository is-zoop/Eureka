import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJiti} from "jiti";
import {fixtureZip} from "./haze-plugin-fixture.mjs";
const jiti=createJiti(import.meta.url);
const {AppFileOperations}=await jiti.import("./automation-app-files.ts");
const {appDownloadData}=await jiti.import("./automation-app-download.ts");
const {parseAppSessionRequest,parseAppSessionRequestInput}=await jiti.import("./automation-session-request.ts");
const {APP_DOWNLOAD_MAX_BYTES}=await jiti.import("./automation-data-limits.ts");

test("dynamic binary downloads stay inside the declared origin and path",()=>{
  const request=parseAppSessionRequest({url:"https://download.example/reports/",method:"GET",response:"bytes",allowDynamicUrl:true,credentials:"omit"});
  const url="https://download.example/reports/file.zip?sign=a%2Bb&expires=123";
  assert.equal(parseAppSessionRequestInput({url},request).url,url);
  for(const url of ["https://evil.example/reports/file.zip","http://download.example/reports/file.zip","https://download.example/reports-evil/file.zip","https://download.example/reports/../secret","https://download.example/reports/%2fsecret","https://u:p@download.example/reports/a.zip","https://download.example/reports/a.zip#x"])
    assert.throws(()=>parseAppSessionRequestInput({url},request));
  assert.throws(()=>parseAppSessionRequestInput({url},parseAppSessionRequest({url:request.url,method:"GET",response:"bytes"})));
  assert.throws(()=>parseAppSessionRequest({...request,response:"json"}));
  assert.throws(()=>parseAppSessionRequest({...request,method:"POST"}));
});
test("download bytes are canonical, complete, bounded and successful before saving",()=>{
  const bytes=Buffer.from([0x50,0x4b,0,255,1]);
  const result={status:200,data:{encoding:"base64",base64:bytes.toString("base64"),bytes:bytes.length,contentType:"application/zip"}};
  assert.equal(appDownloadData(result).base64,bytes.toString("base64"));
  for(const bad of [{...result,status:404},{...result,data:{...result.data,bytes:6}},{...result,data:{...result.data,bytes:APP_DOWNLOAD_MAX_BYTES+1}},{...result,data:{...result.data,base64:"%%%"}}])assert.throws(()=>appDownloadData(bad));
});
async function fixture(work){const root=await mkdtemp(join(tmpdir(),"eureka-download-"));try{const workspace=join(root,"workspace"),output=join(root,"output");await mkdir(workspace);await mkdir(output);const grants=[{id:"output",kind:"directory",path:output,access:"readwrite"}];const ops=new AppFileOperations(workspace,grants,["files.read","files.write"],()=>{});await work({root,workspace,output,ops,grants});}finally{await rm(root,{recursive:true,force:true});}}
test("ZIP extraction preserves nested CSV and binary workbook bytes in the chosen local folder",async()=>fixture(async({workspace,output,ops})=>{
  const csv=Buffer.from([0xd6,0xd0,44,118,97,108,117,101,10]),xlsx=Buffer.from([0x50,0x4b,3,4,255,0]);
  await writeFile(join(workspace,"report.zip"),fixtureZip({"报表.csv":csv,"nested/report.xlsx":xlsx},{prefix:""}));
  const result=await ops.call("extractZip",[{grantId:"workspace",relative:"report.zip"},{grantId:"output"},{}]);
  assert.equal(result.files.length,2);assert.deepEqual(await readFile(join(output,"报表.csv")),csv);assert.deepEqual(await readFile(join(output,"nested/report.xlsx")),xlsx);
  assert.equal(await ops.call("readText",[result.files[0].ref,"gb18030"]),"中,value\n");
  await assert.rejects(ops.call("extractZip",[{grantId:"workspace",relative:"report.zip"},{grantId:"output"},{}]),/已存在/);
  assert.deepEqual(await readFile(join(output,"报表.csv")),csv);
}));
test("ZIP traversal, links, duplicates, CRC corruption and oversize fail before local output",async()=>fixture(async({workspace,output,ops})=>{
  const damaged=fixtureZip({"x.csv":"hello"},{prefix:""});damaged[damaged.indexOf(Buffer.from("hello"))]^=1;
  const oversized=fixtureZip({"x.csv":"hello"},{prefix:""});const central=oversized.indexOf(Buffer.from([0x50,0x4b,1,2]));oversized.writeUInt32LE(513*1024*1024,central+24);
  for(const zip of [fixtureZip({"../escape.csv":"bad"},{prefix:""}),fixtureZip({"link.csv":"x"},{prefix:"",symlink:"link.csv"}),fixtureZip([["a.csv","a"],["A.csv","b"]],{prefix:""}),damaged,oversized]){
    await writeFile(join(workspace,"bad.zip"),zip);await assert.rejects(ops.call("extractZip",[{grantId:"workspace",relative:"bad.zip"},{grantId:"output"},{}]));assert.deepEqual(await readdir(output),[]);
  }
}));
test("legacy GB18030 ZIP names decode without changing file content and write grants are enforced",async()=>fixture(async({workspace,output,ops,grants})=>{
  const zip=fixtureZip({"aa":"data"},{prefix:""});for(let at=zip.indexOf(Buffer.from("aa"));at>=0;at=zip.indexOf(Buffer.from("aa"),at+2)){zip[at]=0xd6;zip[at+1]=0xd0;}
  await writeFile(join(workspace,"names.zip"),zip);await ops.call("extractZip",[{grantId:"workspace",relative:"names.zip"},{grantId:"output"},{}]);assert.equal(await readFile(join(output,"中"),"utf8"),"data");
  const readonly=new AppFileOperations(workspace,grants.map(g=>({...g,access:"read"})),["files.read","files.write"],()=>{});
  await assert.rejects(readonly.prepareWrite({grantId:"output",relative:"download.zip"}));
  await assert.rejects(ops.prepareWrite({grantId:"output",relative:"../escape.zip"}));
}));

async function hashFile(path){const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest("hex");}
test("streaming extraction saves two 40 MiB reports without expanded Base64 or whole-file SDK writes",async()=>fixture(async({workspace,output,ops})=>{
  const content=Buffer.alloc(40*1024*1024,0x61),expected=createHash("sha256").update(content).digest("hex");
  const zip=fixtureZip({"first.csv":content,"nested/second.csv":content},{prefix:"",deflate:true});
  await writeFile(join(workspace,"large.zip"),zip);
  const call=ops.call.bind(ops);ops.call=(method,args)=>{assert.ok(!["readBase64","writeBase64"].includes(method));return call(method,args);};
  const result=await ops.call("extractZip",[{grantId:"workspace",relative:"large.zip"},{grantId:"output"},{}]);
  assert.equal(result.bytes,80*1024*1024);assert.equal(result.files[0].bytes,40*1024*1024);
  assert.equal(await hashFile(join(output,"first.csv")),expected);assert.equal(await hashFile(join(output,"nested/second.csv")),expected);
  assert.deepEqual((await readdir(output)).sort(),["first.csv","nested"]);
}));
test("a later corrupt entry never publishes an earlier staged file or replaces existing data",async()=>fixture(async({workspace,output,ops})=>{
  const zip=fixtureZip({"first.csv":"good","second.csv":"bad"},{prefix:""});zip[zip.indexOf(Buffer.from("bad"))]^=1;
  await writeFile(join(workspace,"damaged.zip"),zip);await writeFile(join(output,"first.csv"),"original");
  await assert.rejects(ops.call("extractZip",[{grantId:"workspace",relative:"damaged.zip"},{grantId:"output"},{overwrite:true}]),/校验/);
  assert.equal(await readFile(join(output,"first.csv"),"utf8"),"original");assert.deepEqual(await readdir(output),["first.csv"]);
}));
