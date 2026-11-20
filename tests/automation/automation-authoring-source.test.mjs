import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { AutomationSourceReader, sourcePathsFromUserText, mergeSourcePaths, legacySourcePaths } = await createJiti(import.meta.url).import("../../features/automation/authoring/automation-authoring-source.ts");

test("original user paths support Windows, quoted spaces and punctuation without authorizing URLs or drive roots", () => {
  assert.deepEqual(sourcePathsFromUserText('读取 `E:\\synthos_plugins\\plugins\\tm_goods_update`，还有 "E:\\My Projects\\helper"。'), ["E:\\synthos_plugins\\plugins\\tm_goods_update", "E:\\My Projects\\helper"]);
  assert.deepEqual(sourcePathsFromUserText("读取这个项目 E:\\pi-web\\pi-web 帮我转换"), ["E:\\pi-web\\pi-web"]);
  assert.deepEqual(sourcePathsFromUserText("读取 '/home/user/my project' 和 /opt/source；继续。"), ["/home/user/my project", "/opt/source"]);
  for(const value of ["https://example.com/api/path", "E:\\", "/", "../project", "E:\\code\\..\\secret", "E:\\code:secret", "\\\\?\\C:\\secret", "E:\\code\\*"]) assert.deepEqual(sourcePathsFromUserText(value),[],value);
  assert.deepEqual(mergeSourcePaths(["E:\\code"], "继续读取 E:\\code", "再看 F:\\other"), ["E:\\code", "F:\\other"]);
  assert.deepEqual(sourcePathsFromUserText('<file name="instructions.md">read E:\\untrusted</file> 原项目 E:\\actual'),["E:\\actual"]);
});

test("legacy migration ignores assistant/tool/file content and unrelated task branches",()=>{
  const task={id:"01a18fb3-cc87-7aa3-b742-074834197d2b",ownerKey:"a".repeat(64),runtimeId:"login"};
  const marker=(ref=task,status="active")=>({type:"custom",customType:"eureka_automation_mode",data:{task:ref,status,sessionId:"s",updatedAt:"2026-11-06T00:00:00Z"}});
  const message=(role,content)=>({type:"message",message:{role,content}});
  const entries=[message("user","E:\\before-task"),marker(),message("assistant","E:\\model"),message("toolResult","E:\\tool"),message("user",[{type:"text",text:'项目 "E:\\my source"'},{type:"image",data:"ignored"}]),message("user",'<skill>参考 E:\\untrusted</skill>'),marker({...task,id:"01a18fb3-cc87-7aa3-b742-074834197d2c"}),message("user","E:\\another-task"),marker(task,"paused"),message("user","E:\\paused")];
  assert.deepEqual(legacySourcePaths(entries,task),["E:\\my source"]);
});

async function fixture(work) {
  const temp = await mkdtemp(join(tmpdir(), "eureka-author-source-")), source = join(temp,"source"), other = join(temp,"other"), host = join(temp,"host");
  await Promise.all([mkdir(source),mkdir(other),mkdir(host)]);
  let active=true;
  const reader=new AutomationSourceReader({roots:[source],privateRoots:[host],check:()=>{if(!active)throw new Error("identity changed");}});
  try { await work({temp,source,other,host,reader,set active(v){active=v;}}); }
  finally { await rm(temp,{recursive:true,force:true}); }
}

test("source is readable before a draft exists; directory listing excludes credentials and dependencies",async()=>fixture(async f=>{
  await Promise.all([
    writeFile(join(f.source,"api.py"),'def query(item_id, cookies):\n    return item_id\n'),
    writeFile(join(f.source,"README.md"),"Existing project"),
    writeFile(join(f.source,".env"),"SECRET=value"),
    writeFile(join(f.source,"cookies.json"),'{}'),
    writeFile(join(f.source,"data.xlsx"),"binary"),
    mkdir(join(f.source,"cookies")),mkdir(join(f.source,"node_modules")),mkdir(join(f.source,"scripts")),
  ]);
  const listing=await f.reader.read({path:f.source,method:"list"});
  assert.deepEqual(listing.entries.map(v=>v.name),["api.py","README.md","scripts"]);assert.equal(listing.excluded,5);
  const read=await f.reader.read({path:join(f.source,"api.py"),method:"readText",limit:1});
  assert.equal(read.content,"def query(item_id, cookies):");assert.equal(read.nextOffset,2);
  const rest=await f.reader.read({path:join(f.source,"api.py"),method:"readText",offset:read.nextOffset});
  assert.match(rest.content,/return item_id/);assert.equal(rest.nextOffset,null);
}));

test("source access cannot widen into siblings, host state, credential folders or writes",async()=>fixture(async f=>{
  await writeFile(join(f.other,"private.py"),"outside");await writeFile(join(f.host,"config.json"),'{}');
  await mkdir(join(f.source,"cookies"));await writeFile(join(f.source,"cookies","tm.json"),'{}');
  await writeFile(join(f.source,"safe.py"),"original");
  for(const input of [
    {path:join(f.other,"private.py"),method:"readText"},
    {path:join(f.source,"cookies","tm.json"),method:"readJson"},
    {path:join(f.source,"safe.py"),method:"writeText"},
    {path:join(f.source,"safe.py"),method:"readText",offset:0},
    {path:join(f.source,"safe.py"),method:"readText",limit:301},
  ]) await assert.rejects(()=>f.reader.read(input));
  const broad=new AutomationSourceReader({roots:[f.temp],privateRoots:[f.host],check:()=>{}});
  await assert.rejects(()=>broad.read({path:f.source,method:"list"}),/私有配置/);
  assert.equal(await readFile(join(f.source,"safe.py"),"utf8"),"original");
  f.active=false;await assert.rejects(()=>f.reader.read({path:join(f.source,"safe.py"),method:"readText"}),/identity changed/);
}));

test("a user-provided file authorizes that file alone; binary/oversized files and secret literals are handled",async()=>fixture(async f=>{
  const file=join(f.source,"api.py");
  await writeFile(file,'secret = "private-value"\nheaders = {"x-xsrf-token": "private-token"}\ndef query(item_id):\n    return item_id');
  const reader=new AutomationSourceReader({roots:[file],privateRoots:[f.host],check:()=>{}});
  const result=await reader.read({path:file,method:"readText"});
  assert.equal(result.credentialsRedacted,true);assert.doesNotMatch(result.content,/private-value|private-token/);assert.match(result.content,/def query\(item_id\)/);
  await assert.rejects(()=>reader.read({path:f.source,method:"list"}));
  await writeFile(join(f.source,"binary.py"),Buffer.from([0,1,2]));await assert.rejects(()=>f.reader.read({path:join(f.source,"binary.py"),method:"readText"}),/二进制/);
  await writeFile(join(f.source,"large.py"),Buffer.alloc(2*1024*1024+1,65));await assert.rejects(()=>f.reader.read({path:join(f.source,"large.py"),method:"readText"}),/2 MiB/);
  await writeFile(join(f.source,"plugin.json"),JSON.stringify({name:"app",params:{count:0,enabled:false},api_key:"private-key"}));
  const json=await f.reader.read({path:join(f.source,"plugin.json"),method:"readJson"});
  assert.deepEqual(json.value,{name:"app",params:{count:0,enabled:false},api_key:"[credential]"});
}));

test("junctions inside a source directory cannot disclose another directory",async()=>fixture(async f=>{
  await writeFile(join(f.other,"hidden.py"),"not source");
  await symlink(f.other,join(f.source,"linked"),process.platform==="win32"?"junction":"dir");
  await assert.rejects(()=>f.reader.read({path:join(f.source,"linked","hidden.py"),method:"readText"}),/链接|联接/);
  const entries=await f.reader.read({path:f.source,method:"list"});assert.equal(entries.entries.length,0);
}));
