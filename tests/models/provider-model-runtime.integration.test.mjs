import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime, createAgentSessionServices } from "@earendil-works/pi-coding-agent";

const root = await mkdtemp(join(tmpdir(), "eureka-provider-extensions-"));
const agentDir = join(root, "agent"), extension = join(agentDir, "extensions", "providers.ts");
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(join(agentDir, "extensions"), { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
after(async () => {
  globalThis.__eurekaProviderModelRuntime = undefined;
  delete globalThis.__eurekaProviderFixture;
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(root, { recursive: true, force: true });
});
await writeFile(extension, `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
const stats = (globalThis.__eurekaProviderFixture ??= { factories: 0, calls: [] });
export default function (pi) {
  stats.factories++;
  for (const [id, name] of [["workbuddy", "WorkBuddy (CN)"], ["workbuddy-global", "WorkBuddy AI (Global)"]]) {
    pi.registerProvider(id, {
      name, baseUrl: "https://unused.invalid/v1", api: "openai-completions",
      models: [{ id: "fixture-model", name: "Fixture · x0.79", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 64 }],
      oauth: { name,
        login: async callbacks => { callbacks.onAuth({ url: "https://unused.invalid/login/" + id }); callbacks.onProgress?.("Fixture login complete"); return { access: "fixture-access-" + id, refresh: "fixture-refresh", expires: Date.now() + 3600000 }; },
        refreshToken: async credential => ({ ...credential, expires: Date.now() + 3600000 }),
        getApiKey: credential => credential.access,
      },
      streamSimple: (model, _context, options) => {
        stats.calls.push({ provider: model.provider, authenticated: options.apiKey === "fixture-access-" + id });
        const stream = createAssistantMessageEventStream();
        const message = { role: "assistant", content: [{type:"text", text:"Fixture response"}], api: model.api, provider: model.provider, model: model.id,
          stopReason: "stop", timestamp: Date.now(), usage: {input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} };
        stream.push({ type: "done", reason: "stop", message }); stream.end(); return stream;
      },
    });
  }
  pi.registerProvider("extension-key", { name:"Extension Key", baseUrl:"https://unused.invalid/v1", api:"openai-completions", apiKey:"\${EUREKA_FIXTURE_EXTENSION_KEY}", models:[{id:"key-model", name:"Key Model", reasoning:false, input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1024,maxTokens:32}] });
}
`);

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { createProviderModelRuntime, getProviderModelRuntime } = await jiti.import("../../server/models/provider-model-runtime.ts");
const { invalidateModelsCache } = await jiti.import("../../server/models/models-cache.ts");
const { storeProviderCredential } = await jiti.import("../../server/models/provider-credential-store.ts");
const oauthRoute = await jiti.import("../../app/api/auth/providers/route.ts");
const apiKeyListRoute = await jiti.import("../../app/api/auth/all-providers/route.ts");
const loginRoute = await jiti.import("../../app/api/auth/login/[provider]/route.ts");
const logoutRoute = await jiti.import("../../app/api/auth/logout/[provider]/route.ts");
const apiKeyRoute = await jiti.import("../../app/api/auth/api-key/[provider]/route.ts");
const parameters = provider => ({ params: Promise.resolve({ provider }) });

test("the picker discovers installed OAuth and API-key providers that a bare SDK runtime omits", async () => {
  const bare = await ModelRuntime.create({ authPath: join(agentDir,"auth.json"), modelsPath:null, modelsStorePath:join(agentDir,"models-store.json"),refreshOnCreate:false });
  assert.equal(bare.getProvider("workbuddy"), undefined);
  const [first, second] = await Promise.all([getProviderModelRuntime(), getProviderModelRuntime()]);
  assert.equal(first, second); assert.equal(globalThis.__eurekaProviderFixture.factories, 1);
  const oauth = await (await oauthRoute.GET()).json();
  assert.deepEqual(oauth.providers.filter(p => p.id.startsWith("workbuddy")).map(p=>[p.id,p.name,p.loggedIn]), [["workbuddy","WorkBuddy (CN)",false],["workbuddy-global","WorkBuddy AI (Global)",false]]);
  const keys = await (await apiKeyListRoute.GET()).json();
  assert.equal(keys.providers.find(p=>p.id==="extension-key").modelCount,1);
  assert(!keys.providers.some(p=>p.id.startsWith("workbuddy")));
});

test("OAuth login SSE saves the extension credential, model dispatch works, and regions log out independently", async () => {
  for (const id of ["workbuddy", "workbuddy-global"]) {
    const response = await loginRoute.GET(new Request("http://localhost/api/auth/login/" + id), parameters(id));
    const events = (await response.text()).split("\n\n").filter(v=>v.startsWith("data: ")).map(v=>JSON.parse(v.slice(6)));
    assert(events.some(event=>event.type==="auth"&&event.url.endsWith("/"+id)));
    assert.equal(events.at(-1).type,"success",JSON.stringify(events));
  }
  const runtime = await getProviderModelRuntime();
  const oauth = await (await oauthRoute.GET()).json();
  for (const id of ["workbuddy","workbuddy-global"]) {
    assert.equal(oauth.providers.find(p=>p.id===id).loggedIn,true);
    const model = (await runtime.getAvailable(id))[0]; assert.equal(model.name,"Fixture · x0.79");
    const result = await runtime.completeSimple(model,{messages:[{role:"user",content:"hello",timestamp:Date.now()}]});
    assert.equal(result.content[0].text,"Fixture response");
  }
  assert.deepEqual(globalThis.__eurekaProviderFixture.calls,[{provider:"workbuddy",authenticated:true},{provider:"workbuddy-global",authenticated:true}]);
  const services = await createAgentSessionServices({cwd:root,agentDir,resourceLoaderOptions:{noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true}});
  assert.equal((await services.modelRuntime.getAvailable("workbuddy")).length,1,"chat/model-selector services see the same extension");
  assert.equal((await logoutRoute.POST(new Request("http://localhost/api/auth/logout/workbuddy",{method:"POST"}),parameters("workbuddy"))).status,200);
  const afterLogout = await (await oauthRoute.GET()).json();
  assert.equal(afterLogout.providers.find(p=>p.id==="workbuddy").loggedIn,false);
  assert.equal(afterLogout.providers.find(p=>p.id==="workbuddy-global").loggedIn,true);
  assert(!JSON.stringify(afterLogout).includes("fixture-access"));
});

test("status readers refresh external credential changes and API-key save/delete keep using extension auth", async () => {
  const runtime = await getProviderModelRuntime();
  await storeProviderCredential("extension-key",{type:"api_key",key:"fixture-key"});
  assert.equal(await getProviderModelRuntime(),runtime,"credential changes do not require another extension factory");
  assert.equal(runtime.getProviderAuthStatus("extension-key").configured,true);
  const saved = await apiKeyRoute.POST(new Request("http://localhost/api/auth/api-key/extension-key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:"new-fixture-key"})}),parameters("extension-key"));
  assert.equal(saved.status,200);
  const status = await (await apiKeyRoute.GET(new Request("http://localhost/"),parameters("extension-key"))).json();
  assert.equal(status.configured,true);assert.equal(status.displayName,"Extension Key");assert(!JSON.stringify(status).includes("fixture-key"));
  await apiKeyRoute.DELETE(new Request("http://localhost/",{method:"DELETE"}),parameters("extension-key"));
  assert.equal((await (await apiKeyRoute.GET(new Request("http://localhost/"),parameters("extension-key"))).json()).configured,false);
});

test("lightweight model enumeration retains installed provider models without starting an agent", async () => {
  const { allowFileRoot } = await jiti.import("../../features/files/server/file-access.ts");
  const modelsRoute = await jiti.import("../../app/api/models/route.ts");
  allowFileRoot(root);
  const previousRegistry = globalThis.__piSessions;
  const response = await modelsRoute.GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(root)}`));
  assert.equal(response.status, 200);
  const models = await response.json();
  assert(models.modelList.some(model => model.provider === "workbuddy-global" && model.id === "fixture-model"));
  assert.equal(models.modelError, undefined);
  assert.equal(globalThis.__piSessions, previousRegistry);
});

test("global settings enumerate models from a packaged working directory without granting file access", async () => {
  const packaged = await mkdtemp(join(tmpdir(), "eureka-packaged-server-")), previousCwd = process.cwd();
  const modelsRoute = await jiti.import("../../app/api/models/route.ts");
  const { getAllowedFileRoots, isExistingFilePathAllowed } = await jiti.import("../../features/files/server/file-access.ts");
  await mkdir(join(packaged, ".pi", "extensions"), { recursive: true });
  await writeFile(join(packaged, ".pi", "extensions", "untrusted.ts"), 'export default function(){ globalThis.__eurekaPackagedProjectRan = true; }');
  try {
    process.chdir(packaged);
    const denied = await modelsRoute.GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(packaged)}`));
    assert.equal(denied.status, 403);
    const response = await modelsRoute.GET(new Request("http://localhost/api/models?scope=global", { headers: { host: "localhost" } }));
    assert.equal(response.status, 200);
    const models = await response.json();
    assert(models.modelList.some(model => model.provider === "workbuddy-global" && model.id === "fixture-model"));
    assert.equal(models.modelError, undefined);
    assert.equal(globalThis.__eurekaPackagedProjectRan, undefined);
    assert.equal(isExistingFilePathAllowed(packaged, await getAllowedFileRoots()), false);
    assert.equal((await modelsRoute.GET(new Request(`http://localhost/api/models?scope=global&cwd=${encodeURIComponent(packaged)}`, { headers: { host: "localhost" } }))).status, 400);
    assert.equal((await modelsRoute.GET(new Request("http://localhost/api/models?scope=global", { headers: { host: "localhost", origin: "https://other.example" } }))).status, 403);
  } finally { process.chdir(previousCwd); await rm(packaged, { recursive: true, force: true }); }
});

test("reload/plugin invalidation removes retired providers; auth reads ignore project-local extensions", async () => {
  const before = await getProviderModelRuntime();assert(before.getProvider("workbuddy"));
  await mkdir(join(agentDir,".pi","extensions"),{recursive:true});
  await writeFile(join(agentDir,".pi","extensions","untrusted.ts"),'export default function(){ globalThis.__eurekaUntrustedProviderRan = true; throw new Error("Project extension must not execute during auth reads"); }');
  const privateRuntime = await createProviderModelRuntime();assert(privateRuntime.getProvider("workbuddy"));
  assert.equal(globalThis.__eurekaUntrustedProviderRan,undefined);
  await rename(extension,extension+".disabled");invalidateModelsCache();
  const after = await getProviderModelRuntime();assert.notEqual(before,after);assert.equal(after.getProvider("workbuddy"),undefined);
  assert((await readFile(join(agentDir,"auth.json"),"utf8")).includes("workbuddy-global"),"removing the extension must not delete credentials");
});
