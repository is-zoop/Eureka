import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";

test("browser APIs reject guests, bind identity and dispose streaming subscriptions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "eureka-browser-api-"));
  const fixture = { user: "a", runtimeUser: "a", calls: [], cleaned: 0 };
  globalThis.__browserApiFixture = fixture;
  t.after(async () => { delete globalThis.__browserApiFixture; await rm(root, { recursive: true, force: true }); });
  const files = {
    "lib/browser-access.ts": await readFile("lib/browser-access.ts", "utf8"),
    "lib/auth/session.ts": `exports.readAuthSession=async()=>{const f=globalThis.__browserApiFixture;return f.user?{principal:{subject:f.user}}:null}`,
    "lib/auth/runtime-session.ts": `exports.readRuntimeHazeSession=()=>{const f=globalThis.__browserApiFixture;return f.runtimeUser?{principal:{subject:f.runtimeUser}}:null}`,
    "lib/auth/config.ts": `exports.getAuthConfig=()=>({issuer:'https://haze.example'})`,
    "lib/rpc-manager.ts": `exports.getRpcSession=id=>id==='chat'?{isAlive:()=>true}:null`,
    "lib/session-reader.ts": `exports.resolveSessionPath=async()=>null`,
    "lib/browser-runtime.ts": `
      exports.browserOwner=(source,subject)=>JSON.stringify([source,subject]);
      exports.hasBrowser=()=>false;
      exports.browserState=(owner,sessionId)=>({sessionId,activeTabId:null,tabs:[]});
      exports.browserReady=async()=>true;
      exports.browserAction=async(owner,id,body)=>{if(body.action==='bad')throw Error('http://secret.example/#launch=private');globalThis.__browserApiFixture.calls.push({owner,id,action:body.action})};
      exports.closeBrowser=async()=>{};
      exports.subscribeBrowser=(owner,id,send,frames)=>{send({type:'state',state:{sessionId:id,tabs:[],activeTabId:null}});globalThis.__browserApiFixture.calls.push({owner,id,frames});return()=>{globalThis.__browserApiFixture.cleaned++}};
    `,
  };
  for (const [file, source] of Object.entries(files)) { const path = join(root, file); await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, source); }
  const jiti = createJiti(import.meta.url, { alias: { "@": root, "next/server": import.meta.resolve("next/server.js") } });
  const routes = await jiti.import("./route.ts");
  const events = await jiti.import("./events/route.ts");
  const request = () => new Request("http://localhost/api/browser?sessionId=chat");
  fixture.user = null;
  assert.equal((await routes.GET(request())).status, 403);
  assert.equal((await events.GET(request())).status, 403);
  fixture.user = "a"; fixture.runtimeUser = "b";
  assert.equal((await routes.GET(request())).status, 403);
  fixture.runtimeUser = "a";
  assert.equal((await routes.GET(new Request("http://localhost/api/browser?sessionId=missing"))).status, 403);
  assert.equal((await routes.GET(request())).status, 200);
  const post = (action) => routes.POST(new Request("http://localhost/api/browser", { method: "POST", body: JSON.stringify({ sessionId: "chat", action }) }));
  assert.equal((await post("open")).status, 200);
  assert.equal(fixture.calls[0].owner, '["https://haze.example","a"]');
  const error = await post("bad");
  assert.equal(error.status, 400); assert.ok(!JSON.stringify(await error.json()).includes("private"));
  const abort = new AbortController();
  const stream = await events.GET(new Request("http://localhost/api/browser/events?sessionId=chat&frames=1", { signal: abort.signal }));
  assert.equal(stream.headers.get("Content-Type"), "text/event-stream");
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"state"/);
  assert.equal(fixture.calls.at(-1).frames, true);
  abort.abort();
  assert.equal(fixture.cleaned, 1);
  assert.equal((await reader.read()).done, true);
});
