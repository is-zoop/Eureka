import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { parseAppSessionRequest, parseAppSessionRequestInput } = await jiti.import("../../features/automation/runtime/automation-session-request.ts");
const { parseAppBrowser } = await jiti.import("../../features/automation/runtime/automation-app-browser.ts");
const request = {url:"https://inventorymanage.taobao.com/seller/inventory/querySkuQuantity",method:"GET"};
const site = {id:"seller",label:"Seller",startUrl:"https://myseller.taobao.com/home",paths:["/home"],operations:[{id:"inventory",label:"Query inventory",description:"Read SKU inventory",effect:"query",kind:"request",request}]};

test("the native body, framework proxy and receipt budgets agree for large responses", async () => {
  const { APP_HTTP_RESPONSE_MAX_BYTES, APP_EXECUTION_VALUE_MAX_BYTES, APP_BROWSER_POST_MAX_BYTES } = await jiti.import("../../features/automation/shared/automation-data-limits.ts");
  const { default: config } = await jiti.import("../../next.config.ts");
  assert.equal(config.experimental.proxyClientMaxBodySize, APP_BROWSER_POST_MAX_BYTES);
  assert.ok(APP_BROWSER_POST_MAX_BYTES > APP_EXECUTION_VALUE_MAX_BYTES);
  assert.ok(APP_EXECUTION_VALUE_MAX_BYTES > APP_HTTP_RESPONSE_MAX_BYTES);
  const native = await readFile(new URL("../../desktop/src-tauri/src/automation_session_request.rs",import.meta.url),"utf8");
  const contract = JSON.parse(await readFile(new URL("../../features/automation/sdk/automation-sdk-contract.json",import.meta.url),"utf8"));
  const build = await readFile(new URL("../../desktop/src-tauri/build.rs",import.meta.url),"utf8");
  assert.ok(native.includes('include!(concat!(env!("OUT_DIR"), "/automation-sdk-limits.rs"))'));
  assert.ok(build.includes('contract["limits"]["httpResponseBytes"]'));
  assert.equal(contract.limits.httpResponseBytes, APP_HTTP_RESPONSE_MAX_BYTES);
});
test("API subdomains are explicitly declared; method and original string parameters survive", () => {
  const declaration = parseAppBrowser({schemaVersion:1,sites:[site]},["browser.read"]);
  assert.equal(declaration.sites[0].operations[0].request.url, request.url);
  assert.deepEqual(parseAppSessionRequestInput({query:{itemId:"00123",quantity:"0"}},request), {query:{itemId:"00123",quantity:"0"}});
  assert.equal(parseAppBrowser({schemaVersion:1,sites:[{...site,operations:[{...site.operations[0],request:{...request,method:"POST"}}]}]},["browser.read"]).sites[0].operations[0].effect,"query");
});
test("arbitrary destinations, credentials, headers, bodies and signatures cannot override the declaration", () => {
  for (const url of ["file:///tmp/data", "ftp://example.com/api", "https://user:pass@example.com/api", "https://example.com/api#fragment", "not a URL"]) assert.throws(()=>parseAppSessionRequest({...request,url}));
  for (const headers of [{Cookie:"secret"},{Authorization:"secret"},{Host:"other"},{Accept:"json\r\nCookie: secret"}]) assert.throws(()=>parseAppSessionRequest({...request,headers}));
  for (const input of [{url:"https://other.example/"},{headers:{Cookie:"x"}},{query:{id:1}},{form:{id:"x"}},{json:{id:"x"}}]) assert.throws(()=>parseAppSessionRequestInput(input,request));
  const signed = parseAppSessionRequest({...request,url:"https://acs.m.taobao.com/h5/example/1.0/",method:"POST",signature:{kind:"taobao-mtop",appKey:"123"}});
  const data='{"itemId":"00123"}'; assert.equal(parseAppSessionRequestInput({form:{data}},signed).form.data,data);
  for(const input of [{form:{data},query:{sign:"x"}},{form:{data,appKey:"456"}},{json:{data}},{form:{data},json:{}}]) assert.throws(()=>parseAppSessionRequestInput(input,signed));
  assert.throws(()=>parseAppSessionRequest({...signed,url:"https://taobao.com.attacker.example/h5/"}));
});

test("HTTP, HTTPS, custom ports and declared query defaults are accepted without changing the original protocol", () => {
  for (const url of ["http://example.com:8088/api?version=1&tag=a&tag=b", "https://example.com:8443/api?q=a%20b", "http://127.0.0.1:9000/api"]) {
    const declaration=parseAppSessionRequest({...request,url,method:"POST",credentials:"omit"});
    assert.equal(declaration.url,url);assert.equal(declaration.credentials,"omit");
    assert.deepEqual(parseAppSessionRequestInput({query:{version:"2",id:"00123"},form:{quantity:"0"}},declaration),{query:{version:"2",id:"00123"},form:{quantity:"0"}});
    assert.equal(parseAppBrowser({schemaVersion:1,sites:[{...site,operations:[{...site.operations[0],request:declaration}]}]},["browser.read"]).sites[0].operations[0].request.url,url);
  }
  assert.throws(()=>parseAppSessionRequest({...request,url:"ftp://example.com"}),/HTTP 或 HTTPS/);
  assert.throws(()=>parseAppSessionRequest({...request,url:"https://example.com/#x"}),/#fragment/);
  assert.throws(()=>parseAppSessionRequest({...request,credentials:"include-everywhere"}),/credentials/);
});

test("HEAD and OPTIONS declarations work while GET/HEAD body conflicts still fail before dispatch", () => {
  for(const method of ["HEAD","OPTIONS"]){
    const declaration=parseAppSessionRequest({...request,method,response:"text",credentials:"browser"});
    assert.deepEqual(parseAppSessionRequestInput({},declaration),{});
    if(method==="HEAD")for(const body of [{json:null},{form:{a:"1"}}])assert.throws(()=>parseAppSessionRequestInput(body,declaration),/GET\/HEAD/);
  }
});

test("MTOP query defaults use the actual serialized data and reject signature overrides or duplicate data", () => {
  const data='{ "itemId": "00123" }',url=new URL("https://acs.m.taobao.com/h5/example/1.0/");url.searchParams.set("data",data);
  const signed=parseAppSessionRequest({...request,url:url.href,method:"POST",signature:{kind:"taobao-mtop",appKey:"123"}});
  assert.deepEqual(parseAppSessionRequestInput({},signed),{});
  assert.deepEqual(parseAppSessionRequestInput({query:{data:"{}"}},signed),{query:{data:"{}"}});
  assert.throws(()=>parseAppSessionRequestInput({form:{data}},signed),/只能声明一次/);
  for(const field of ["sign","t","appKey"]){const u=new URL(url);u.searchParams.set(field,"stale");assert.throws(()=>parseAppSessionRequest({...signed,url:u.href}),/不能预置/);}
  const duplicate=new URL(url);duplicate.searchParams.append("data","{}");assert.throws(()=>parseAppSessionRequest({...signed,url:duplicate.href}),/重复/);
  assert.throws(()=>parseAppSessionRequest({...signed,credentials:"omit"}),/浏览器登录态/);
  assert.throws(()=>parseAppSessionRequest({...signed,url:"http://acs.m.taobao.com/api"}),/HTTPS/);
});
test("API mutations require write capability but neither an account marker nor DOM verification", () => {
  const mutation={...site,operations:[{...site.operations[0],effect:"mutation"}]};
  assert.equal(parseAppBrowser({schemaVersion:1,sites:[mutation]},["browser.read","browser.write"]).sites[0].operations[0].effect,"mutation");
  const valid={...mutation,account:{locator:{css:"#account"}},operations:[{...mutation.operations[0],verify:{field:{locator:{css:"#quantity"}},mode:"equals",expected:"10"}}]};
  assert.throws(()=>parseAppBrowser({schemaVersion:1,sites:[valid]},["browser.read"]));
  assert.equal(parseAppBrowser({schemaVersion:1,sites:[valid]},["browser.read","browser.write"]).sites[0].operations[0].effect,"mutation");
});
test("API preflight ignores legacy DOM verification even when the field cannot be read", async () => {
  const script=await readFile(new URL("../../desktop/src-tauri/src/app-browser.js",import.meta.url),"utf8");
  const declaration=structuredClone(site);
  Object.assign(declaration.operations[0],{effect:"mutation",verify:{field:{locator:{css:"#missing-budget"}},mode:"equals",expected:"100"}});
  const run=vm.createContext({URL,location:{href:site.startUrl},document:{querySelectorAll(){throw new Error("DOM verification must not run");}},crypto:{getRandomValues:bytes=>bytes.fill(1)},window:{},request:{method:"request",site:declaration,args:{operationId:"inventory"},expected:{account:null}}});
  const result=vm.runInContext(`${script}(request,"preflight","",null)`,run);
  assert.equal(typeof result.key,"string");assert.equal(result.before,null);assert.equal(result.error,undefined);
});
test("fixed DOM adapter preflights session API without executing caller JavaScript or a network request", async () => {
  const script=await readFile(new URL("../../desktop/src-tauri/src/app-browser.js",import.meta.url),"utf8");
  const context={URL,location:{href:site.startUrl},document:{},crypto:{getRandomValues:bytes=>bytes.fill(1)},window:{},request:{method:"request",site,args:{operationId:"inventory",input:{query:{itemId:"00123"}}},expected:{account:null}}};
  const run=vm.createContext(context);
  const before=vm.runInContext(`${script}(request,"preflight","",null)`,run);
  assert.equal(typeof before.key,"string"); assert.equal(before.before,null);
  const executed=vm.runInContext(`${script}(request,"execute","",null)`,run);
  assert.match(executed.error,/原生宿主/);
});
