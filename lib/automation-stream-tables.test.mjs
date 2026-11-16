import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {AppFileOperations}=await jiti.import("./automation-app-files.ts");
const {AppTableOperations}=await jiti.import("./automation-tables.ts");
const {streamAppDownload}=await jiti.import("./automation-app-download.ts");
const ref=name=>({grantId:"workspace",relative:name});
async function fixture(work){const workspace=await mkdtemp(join(tmpdir(),"sdk-stream-tables-"));let active=true;const check=()=>{if(!active)throw new Error("cancelled");};const files=new AppFileOperations(workspace,[],["files.read","files.write"],check),tables=new AppTableOperations(files,check);try{await work({workspace,files,tables,cancel:()=>active=false});}finally{await tables.dispose();await files.dispose();await rm(workspace,{recursive:true,force:true});}}
test("native-style 40 MiB download never returns Base64 and verifies SHA256 before publication",()=>fixture(async({workspace,files})=>{
 const chunk=Buffer.alloc(1024*1024,0x61),hash=createHash('sha256');for(let i=0;i<40;i++)hash.update(chunk);const sha256=hash.digest('hex');
 const saved=await streamAppDownload(files,ref('report.zip'),false,{sha256,maxBytes:50*1024*1024},async sink=>{assert.equal(sink.timeoutMs,180000);const f=await open(sink.path,'wx');try{for(let i=0;i<40;i++)await f.write(chunk);}finally{await f.close();}return{status:200,data:{encoding:'file',bytes:40*1024*1024,contentType:'application/zip'}};});
 assert.equal(saved.bytes,40*1024*1024);assert.equal(saved.sha256,sha256);assert.deepEqual(await readdir(workspace),['report.zip']);const read=await files.call('readChunk',[ref('report.zip'),{offset:39*1024*1024,length:1024*1024}]);assert.equal(read.eof,true);assert.equal(Buffer.from(read.base64,'base64').length,1024*1024);
}));
test("interrupted, corrupt and conflicting downloads do not replace existing user files",()=>fixture(async({workspace,files,cancel})=>{
 await writeFile(join(workspace,'report.zip'),'original');let invoked=false;
 await assert.rejects(streamAppDownload(files,ref('report.zip'),false,{},async()=>{invoked=true;}));assert.equal(invoked,false);
 await assert.rejects(streamAppDownload(files,ref('report.zip'),true,{sha256:'0'.repeat(64)},async sink=>{await writeFile(sink.path,'bad');return{status:200,data:{encoding:'file',bytes:3}};}));assert.equal(await readFile(join(workspace,'report.zip'),'utf8'),'original');
 await assert.rejects(streamAppDownload(files,ref('new.zip'),false,{},async sink=>{await writeFile(sink.path,'partial');cancel();return{status:200,data:{encoding:'file',bytes:7}};}),/cancelled/);assert.deepEqual(await readdir(workspace),['report.zip']);
}));
test("chunk writers atomically commit files beyond the legacy 16 MiB limit and reject cross-run handles",()=>fixture(async({workspace,files})=>{
 const writer=await files.call('openWriter',[ref('large.bin'),{}]),chunk=Buffer.alloc(1024*1024,7).toString('base64');for(let i=0;i<20;i++)await files.call('writeChunk',[writer.id,chunk]);const saved=await files.call('commitWriter',[writer.id]);assert.equal(saved.bytes,20*1024*1024);await assert.rejects(files.call('writeChunk',[writer.id,chunk]));
 await assert.rejects(files.call('openWriter',[ref('../escape'),{}]));const readOnly=new AppFileOperations(workspace,[],['files.read'],()=>{});await assert.rejects(readOnly.call('openWriter',[ref('no.bin'),{}]));
 const aborted=await files.call('openWriter',[ref('partial.bin'),{}]);await files.call('writeChunk',[aborted.id,chunk]);await files.call('abortWriter',[aborted.id]);assert.deepEqual(await readdir(workspace),['large.bin']);
}));
test("CSV batch processing preserves identifiers, quoted newlines, delimiters and Unicode",()=>fixture(async({workspace,tables})=>{
 const writer=await tables.call('createWriter',[ref('report.csv'),{format:'csv',columns:[{key:'id',type:'text'},{key:'name',type:'text'},{key:'cost',type:'number'}]}]);
 await tables.call('appendRows',[writer.id,[{id:'000012345678901234567890',name:'中文,含逗号\n下一行"引号',cost:12.5},{id:'=1+1',name:'normal',cost:0}]]);await tables.call('commitWriter',[writer.id]);
 const reader=await tables.call('openReader',[ref('report.csv'),{format:'csv'}]),batch=await tables.call('readRows',[reader.id,100]);assert.equal(batch.done,true);assert.deepEqual(batch.rows[1].values,['000012345678901234567890','中文,含逗号\n下一行"引号','12.5']);assert.equal(batch.rows[2].values[0],"'=1+1");assert.equal((await readFile(join(workspace,'report.csv'))).subarray(0,3).toString('hex'),'efbbbf');
 await writeFile(join(workspace,'gbk.csv'),Buffer.from([0xd6,0xd0,44,49,10]));const gbk=await tables.call('openReader',[ref('gbk.csv'),{format:'csv',encoding:'gb18030'}]);assert.deepEqual((await tables.call('readRows',[gbk.id])).rows[0].values,['中','1']);
}));
test("XLSX streaming batches create real worksheets, formats, typed cells and cached formulas",()=>fixture(async({workspace,tables})=>{
 const columns=[{key:'id',type:'text',width:24},{key:'cost',type:'number',numFmt:'0.00'},{key:'date',type:'date'},{key:'roi',type:'formula',numFmt:'0.00'}];
 const writer=await tables.call('createWriter',[ref('report.xlsx'),{format:'xlsx',sheets:[{name:'明细',columns},{name:'汇总',columns:[{key:'total',type:'number'}]}]}]);
 for(let batch=0;batch<3;batch++)await tables.call('appendRows',[writer.id,Array.from({length:1000},(_,i)=>({id:'000012345678901234567890',cost:12.5,date:'2026-11-13',roi:{formula:`B${batch*1000+i+2}*2`,result:25}})),'明细']);
 await tables.call('appendRows',[writer.id,[[37500]],'汇总']);const saved=await tables.call('commitWriter',[writer.id]);assert.equal(saved.rows,3001);
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(join(workspace,'report.xlsx'));assert.equal(book.worksheets.length,2);assert.equal(book.getWorksheet('明细').getCell('A2').value,'000012345678901234567890');assert.equal(book.getWorksheet('明细').getCell('B2').numFmt,'0.00');assert.equal(book.getWorksheet('明细').getCell('D2').value.result,25);assert.equal(book.getWorksheet('明细').views[0].ySplit,1);
 const reader=await tables.call('openReader',[ref('report.xlsx'),{format:'xlsx'}]);let count=0,done=false;while(!done){const batch=await tables.call('readRows',[reader.id,500]);count+=batch.rows.length;done=batch.done;}assert.equal(count,3003);
}));
test("table failures and disposal keep old files intact and clean up pending outputs",()=>fixture(async({workspace,tables})=>{
 await writeFile(join(workspace,'old.csv'),'old');const writer=await tables.call('createWriter',[ref('old.csv'),{format:'csv',overwrite:true,columns:[{key:'cost',type:'number'}]}]);await assert.rejects(tables.call('appendRows',[writer.id,[['not a number']]]));assert.equal(await readFile(join(workspace,'old.csv'),'utf8'),'old');
 await tables.call('createWriter',[ref('pending.xlsx'),{format:'xlsx',sheets:[{name:'Data',columns:[{key:'id',type:'text'}]}]}]);await tables.dispose();await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(await readdir(workspace),['old.csv']);
}));
