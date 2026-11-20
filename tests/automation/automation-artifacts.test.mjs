import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url),{snapshotArtifact,streamArtifact,validateArtifact}=await jiti.import('../../features/automation/runtime/automation-artifacts.ts'),{AppFileOperations}=await jiti.import('../../features/automation/runtime/automation-app-files.ts');
test('binary artifacts beyond old save limits preserve bytes and stream independently of the original file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eureka-artifacts-'));try{
 const bytes=Buffer.alloc(33*1024*1024,0xa7);bytes[0]=0;bytes[1]=0xff;await writeFile(join(root,'report.zip'),bytes);
 const files=new AppFileOperations(root,[],['files.read'],()=>{}),target=join(root,'snapshot'),info=await snapshotArtifact(files,{grantId:'workspace',relative:'report.zip'},target,()=>{});
 assert.equal(info.size,bytes.length);assert.equal(info.sha256,createHash('sha256').update(bytes).digest('hex'));await writeFile(join(root,'report.zip'),'changed');
 const reader=(await streamArtifact(target,info.size,()=>{})).getReader(),hash=createHash('sha256');let size=0;for(;;){const {value,done}=await reader.read();if(done)break;assert(value.length<=65536);hash.update(value);size+=value.length;}assert.equal(size,info.size);assert.equal(hash.digest('hex'),info.sha256);
 await assert.rejects(snapshotArtifact(files,{grantId:'unknown'},join(root,'bad'),()=>{}),/授权/);await assert.rejects(snapshotArtifact(files,{grantId:'workspace',relative:'../private'},join(root,'bad'),()=>{}));
 for(const name of ['../private.zip','CON.zip','bad\nname','bad.'])assert.throws(()=>validateArtifact(name,'application/zip'));
 let checks=0;const cancelled=await streamArtifact(target,info.size,()=>{if(++checks>1)throw new Error('workspace reset');});await assert.rejects(cancelled.getReader().read(),/workspace reset/);
 assert.equal((await readFile(target)).length,info.size);
 }finally{await rm(root,{recursive:true,force:true});}
});
