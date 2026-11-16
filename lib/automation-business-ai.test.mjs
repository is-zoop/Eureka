import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url),{DEFAULT_BUSINESS_AI,parseBusinessAi}=await jiti.import('./automation-business-ai.ts');
const {readBusinessAi,saveBusinessAi}=await jiti.import('./automation-business-ai-store.ts'),{AutomationAppStore}=await jiti.import('./automation-app-store.ts');
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import('./automation-app-package.ts'),{fileAutomationExample}=await jiti.import('./automation-app-example.ts');
const {takeAppLease}=await jiti.import('./automation-app-lease.ts');
test('business AI preferences preserve old defaults, reject invalid limits, stay private and enforce idle revisions',async()=>{
 assert.deepEqual(parseBusinessAi({model:null,thinkingLevel:null}),DEFAULT_BUSINESS_AI);
 const base=await mkdtemp(join(tmpdir(),'eureka-business-ai-')),store=new AutomationAppStore(base,'a'.repeat(64),()=>{});
 try{
 const files=parseAutomationAppArchive(fileAutomationExample()).files,plugin=JSON.parse(files.get('plugin.json'));plugin.extensions['com.eureka'].automation.capabilities.push('ai');plugin.extensions['com.eureka'].automation.files.push('ai/rules.json');files.set('plugin.json',Buffer.from(JSON.stringify(plugin)));files.set('ai/rules.json',Buffer.from(JSON.stringify({schemaVersion:1,rules:{classify:{instruction:'classify',output:{type:'text'}}}})));
 const install=await store.install(inspectAutomationFiles(files),0);assert.deepEqual((await readBusinessAi(store,install.id)).settings,DEFAULT_BUSINESS_AI);
 const settings={model:{provider:'fixture',modelId:'model'},thinkingLevel:'low',timeoutMs:180000,maxTokens:8000};
 const saved=await saveBusinessAi(store,install.id,install.revision,0,settings);assert.equal(saved.revision,1);assert.deepEqual((await readBusinessAi(store,install.id)).settings,settings);
 await assert.rejects(saveBusinessAi(store,install.id,install.revision,0,settings),/变化/);
 assert.throws(()=>parseBusinessAi({...settings,timeoutMs:0}));assert.throws(()=>parseBusinessAi({...settings,secret:'no'}));
 const release=await takeAppLease(store.dataDirectory(install.id));try{await assert.rejects(saveBusinessAi(store,install.id,install.revision,1,settings),/运行/);}finally{await release();}
 assert.equal(parseAutomationAppArchive((await store.export(install.id)).bytes).files.has('business-ai.json'),false);
 }finally{await rm(base,{recursive:true,force:true});}
});
