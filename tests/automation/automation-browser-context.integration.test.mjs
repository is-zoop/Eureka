import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
const adapter=await readFile(new URL('../../desktop/src-tauri/src/app-browser.js',import.meta.url),'utf8');
test('fixed browser adapter handles same-origin frames, open shadows and native file selection without widening scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eureka-browser-context-'));
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/frame'?`<input id="query" aria-label="Search"><span id="value">frame value</span><div id="inner"></div><script>document.querySelector('#inner').attachShadow({mode:'open'}).innerHTML='<button id="inside">Search</button><span id="nested">nested value</span>';</script>`:`<span id="account">Fixture account</span><span id="top">top value</span><iframe id="same" src="/frame"></iframe><iframe id="cross" src="http://localhost:${server.address().port}/frame"></iframe><div id="open"></div><div id="closed"></div><input id="upload" type="file" aria-label="Report file"><span id="receipt">empty</span><script>document.querySelector('#open').attachShadow({mode:'open'}).innerHTML='<input id="query" aria-label="Search"><span id="value">shadow value</span>';document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML='<span id="value">closed value</span>';document.querySelector('#upload').addEventListener('change',async e=>{window.uploadChanges=(window.uploadChanges||0)+1;window.uploadBytes=Array.from(new Uint8Array(await e.target.files[0].arrayBuffer()));document.querySelector('#receipt').textContent=e.target.files[0].name;});</script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:850}}),base=`http://127.0.0.1:${server.address().port}`;await page.goto(base+'/top');await page.frameLocator('#same').locator('#value').waitFor();
 const site={id:'fixture',label:'Fixture',startUrl:base+'/top',paths:['/top','/frame'],account:{locator:{css:'#account'}},operations:[]};
 const run=(request,phase='read',key='',baseline=null)=>page.evaluate(({adapter,request,phase,key,baseline})=>(0,eval)(adapter)(request,phase,key,baseline),{adapter,request:{site,...request},phase,key,baseline});
 assert.equal((await run({method:'read',args:{field:{locator:{css:'#top'}}}})).value,'top value');
 const frame={kind:'frame',locator:{css:'#same'}},shadow={kind:'shadow',locator:{css:'#open'}};
 assert.equal((await run({method:'read',args:{field:{locator:{css:'#value',context:[frame]}}}})).value,'frame value');
 assert.equal((await run({method:'read',args:{field:{locator:{css:'#value',context:[shadow]}}}})).value,'shadow value');
 assert.equal((await run({method:'read',args:{field:{locator:{css:'#nested',context:[frame,{kind:'shadow',locator:{css:'#inner'}}]}}}})).value,'nested value');
 for(const context of [[{kind:'frame',locator:{css:'#cross'}}],[{kind:'shadow',locator:{css:'#closed'}}]])assert.ok((await run({method:'read',args:{field:{locator:{css:'#value',context}}}})).error);
 site.operations=[{id:'search',kind:'fill',effect:'query',locator:{css:'#query',context:[frame]}}];let request={method:'operation',args:{operationId:'search',input:{value:'00123'}}};let before=await run(request,'preflight');assert.equal(before.error,undefined);assert.equal((await run(request,'execute',before.key,before.before)).error,undefined);assert.equal(await page.frameLocator('#same').locator('#query').inputValue(),'00123');assert.ok((await run(request,'execute',before.key,before.before)).error);
 const file=join(root,'report.csv'),bytes=Buffer.from([0x81,0x00,0xff,0x2c,0x31]);await writeFile(file,bytes);
 site.operations=[{id:'upload',kind:'upload',effect:'mutation',locator:{css:'#upload'},upload:{maxBytes:1024},verify:{field:{locator:{css:'#receipt'}},mode:'equals',expected:'report.csv'}}];request={method:'operation',args:{operationId:'upload',input:{files:[{filename:'report.csv',size:bytes.length}]}}};before=await run(request,'preflight');assert.equal(before.error,undefined);assert.equal((await run(request,'execute',before.key,before.before)).nativeUpload,true);
 const cdp=await page.context().newCDPSession(page),remote=await cdp.send('Runtime.evaluate',{expression:`(()=>{const s=window.__eurekaAppUpload;delete window.__eurekaAppUpload;return s&&s.id===${JSON.stringify(before.key)}&&s.target?.isConnected?s.target:null})()`,returnByValue:false});
 const {node}=await cdp.send('DOM.describeNode',{objectId:remote.result.objectId});await cdp.send('DOM.setFileInputFiles',{files:[file],backendNodeId:node.backendNodeId});await cdp.send('Runtime.releaseObject',{objectId:remote.result.objectId});await page.waitForFunction(()=>window.uploadBytes?.length===5);
 assert.deepEqual(await page.evaluate(()=>window.uploadBytes),[...bytes]);assert.equal((await run(request,'verify',before.key,before.before)).verified,true);assert.equal(await page.evaluate(()=>window.uploadChanges),1);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
