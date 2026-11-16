import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {prepareAppUpload}=await jiti.import("./automation-app-upload.ts");
const {parseAppSessionRequest,parseAppSessionRequestInput}=await jiti.import("./automation-session-request.ts");
const declaration={url:"https://api.example/upload",method:"POST",credentials:"omit",auth:{kind:"bearer",credentialId:"shop"},multipart:{fields:["shop"],files:[{name:"report",contentTypes:["text/csv"]}]}};
const upload={multipart:{fields:{shop:"fixture"},files:[{name:"report",ref:{grantId:"approved"},contentType:"text/csv"}]}};
test("auth and upload declarations are opt-in and cannot replace privileged headers",()=>{
 assert.equal(parseAppSessionRequest(declaration).auth.credentialId,"shop");
 for(const patch of [{url:"http://api.example/upload"},{credentials:"browser"},{auth:{kind:"api-key",credentialId:"shop",header:"Cookie"}},{auth:{kind:"bearer",credentialId:"shop",header:"Authorization"}},{headers:{"Content-Type":"multipart/form-data"}},{redirects:1}])assert.throws(()=>parseAppSessionRequest({...declaration,...patch}));
 assert.deepEqual(parseAppSessionRequestInput(upload,declaration),upload);
 for(const input of [{...upload,json:{}},{multipart:{...upload.multipart,fields:{unknown:"x"}}},{multipart:{files:[{...upload.multipart.files[0],path:"C:/private"}]}},{multipart:{files:[{...upload.multipart.files[0],contentType:"application/zip"}]}},{multipart:{files:[...upload.multipart.files,...upload.multipart.files]}},{multipart:{files:[{...upload.multipart.files[0],filename:"../secret"}]}}])assert.throws(()=>parseAppSessionRequestInput(input,declaration));
});
test("large uploads use authorized refs and private immutable snapshots, never IPC bytes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"eureka-upload-"));
 try{const source=join(root,"report.csv"),directory=join(root,"private");await mkdir(directory);const data=Buffer.alloc(17*1024*1024,0x81);await writeFile(source,data);let calls=0;
 const files={readPath:async ref=>{assert.equal(ref.grantId,"approved");calls++;return source;}};
 const prepared=await prepareAppUpload(files,declaration,upload,directory,()=>{}),file=prepared.input.multipart.files[0];
 assert.equal(calls,1);assert.equal(file.size,data.length);assert.equal(file.sha256,createHash("sha256").update(data).digest("hex"));assert.equal(JSON.stringify(prepared.input).length<2000,true);assert.notEqual(file.path,source);assert.equal(file.ref,undefined);
 await writeFile(source,"changed");assert.deepEqual(await readFile(file.path),data);await prepared.dispose();assert.deepEqual(await readdir(directory),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("oversized, revoked and modified sources fail before dispatch and leave no snapshots",async()=>{
 const root=await mkdtemp(join(tmpdir(),"eureka-upload-"));try{const source=join(root,"source.csv");await writeFile(source,"abcdef");const files={readPath:async()=>source};
 await assert.rejects(()=>prepareAppUpload(files,{...declaration,multipart:{...declaration.multipart,maxBytes:2}},upload,root,()=>{}),/大小/);
 await assert.rejects(()=>prepareAppUpload({readPath:async()=>{throw new Error("revoked");}},declaration,upload,root,()=>{}),/revoked/);
 let calls=0;await assert.rejects(()=>prepareAppUpload(files,declaration,upload,root,()=>{if(++calls>1)throw new Error("cancelled");}),/cancelled/);
 assert.deepEqual(await readdir(root),["source.csv"]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("browser snapshots preserve file names and remain separate from mutable source files",async()=>{
 const root=await mkdtemp(join(tmpdir(),"eureka-upload-"));try{const source=join(root,"source.csv");await writeFile(source,"original");const prepared=await prepareAppUpload({readPath:async()=>source},declaration,{multipart:{files:[{name:"report",ref:{grantId:"approved"},filename:"报表.csv",contentType:"text/csv"}]}},root,()=>{},true);
 const file=prepared.input.multipart.files[0];assert.equal(file.path.endsWith("报表.csv"),true);await writeFile(source,"changed");assert.equal(await readFile(file.path,"utf8"),"original");await prepared.dispose();assert.deepEqual(await readdir(root),["source.csv"]);
 }finally{await rm(root,{recursive:true,force:true});}
});
