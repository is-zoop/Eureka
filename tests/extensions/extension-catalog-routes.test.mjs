import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const root=await mkdtemp(join(tmpdir(),'eureka-catalog-test-'));
await writeFile(join(root,'config.cjs'),'exports.getAuthConfig=()=>({issuer:globalThis.__catalogIssuer});');
await writeFile(join(root,'marketplace.cjs'),'exports.refreshMarketplaceSession=async()=>{globalThis.__catalogAuthReads++;return globalThis.__catalogSession?{session:globalThis.__catalogSession}:null};exports.hasMarketplaceAccess=s=>s.principal.permissions.includes("market");');
await writeFile(join(root,'session.cjs'),'exports.readGuestSession=async()=>false;exports.writeAuthSession=async()=>{};exports.readAuthSession=async()=>globalThis.__catalogSession;');
const jiti=createJiti(import.meta.url,{tryNative:false,tsconfigPaths:false,alias:{'server-only':resolve('node_modules/next/dist/compiled/server-only/empty.js'),'@/lib/auth/config':join(root,'config.cjs'),'@/lib/auth/marketplace':join(root,'marketplace.cjs'),'@/lib/auth/session':join(root,'session.cjs'),'@':resolve('.')}});
const route=jiti('../../app/api/organization-extensions/route.ts'),categories=jiti('../../app/api/organization-extensions/categories/route.ts');
const {toggleOrganizationExtensionFavorite}=jiti('@/server/extensions/organization-extensions');
const originalFetch=globalThis.fetch;let network=0;
globalThis.__catalogIssuer='https://catalog-a.test';globalThis.__catalogAuthReads=0;
globalThis.__catalogSession={accessToken:'test-token',principal:{subject:'a',permissions:['market']}};
globalThis.fetch=async input=>{network++;const url=new URL(String(input));await new Promise(r=>setTimeout(r,5));if(url.pathname.endsWith('/favorite'))return Response.json({data:{is_favorite:true}});if(url.pathname.endsWith('/business-categories'))return Response.json({data:[{id:1,name:'Category'}]});return Response.json({data:{items:[{id:'1',name:url.hostname,type:'Skill'}],total:1}});};
after(async()=>{globalThis.fetch=originalFetch;for(const key of ['__catalogIssuer','__catalogAuthReads','__catalogSession'])delete globalThis[key];await rm(root,{recursive:true,force:true});});
const request=(force=false)=>({nextUrl:new URL('http://localhost/api/organization-extensions?type=skill'+(force?'&force=1':''))});
test('catalog routes reuse upstream data but still authenticate every hit, including permission revocation',async()=>{
 const first=await route.GET(request()),second=await route.GET(request());assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(network,1);assert.equal(globalThis.__catalogAuthReads,2);
 globalThis.__catalogSession.principal.permissions=[];assert.equal((await route.GET(request())).status,403);assert.equal(network,1);
 globalThis.__catalogSession=null;assert.equal((await route.GET(request())).status,401);assert.equal(network,1);
 globalThis.__catalogSession={accessToken:'test-token',principal:{subject:'a',permissions:['market']}};
});
test('manual refresh, favorites, issuer changes and token changes do not reuse an obsolete catalog',async()=>{
 const before=network;await route.GET(request(true));assert.equal(network,before+1);
 await toggleOrganizationExtensionFavorite('1','test-token');await route.GET(request());assert.equal(network,before+3);
 globalThis.__catalogIssuer='https://catalog-b.test';const changed=await route.GET(request());assert.equal((await changed.json()).items[0].name,'catalog-b.test');assert.equal(network,before+4);
 globalThis.__catalogSession.accessToken='other-login-token';await route.GET(request());assert.equal(network,before+5);
});
test('concurrent category requests share upstream work without skipping authentication',async()=>{
 const before=network,auth=globalThis.__catalogAuthReads;const results=await Promise.all(Array.from({length:5},()=>categories.GET(new Request('http://localhost/api/organization-extensions/categories'))));
 assert(results.every(r=>r.status===200));assert.equal(network,before+1);assert.equal(globalThis.__catalogAuthReads,auth+5);
});

test('parallel marketplace checks share userInfo only while pending; the next request checks revocation again',async()=>{
 await writeFile(join(root,'runtime.cjs'),'exports.refreshRuntimeHazeSession=async()=>globalThis.__catalogSession;');
 await writeFile(join(root,'provider.cjs'),'exports.getIdentityProvider=()=>({userInfo:async()=>{globalThis.__catalogPrincipalReads++;await new Promise(r=>setTimeout(r,10));return structuredClone(globalThis.__catalogSession.principal);}});');
 const authJiti=createJiti(import.meta.url,{tryNative:false,tsconfigPaths:false,alias:{'server-only':resolve('node_modules/next/dist/compiled/server-only/empty.js'),'@/lib/auth/config':join(root,'config.cjs'),'@/lib/auth/session':join(root,'session.cjs'),'@/lib/auth/runtime-session':join(root,'runtime.cjs'),'@/lib/auth/provider':join(root,'provider.cjs'),'@':resolve('.')}});
 const {refreshMarketplaceSession}=authJiti('../../lib/auth/marketplace.ts');globalThis.__catalogPrincipalReads=0;
 try{await Promise.all(Array.from({length:6},()=>refreshMarketplaceSession(true)));assert.equal(globalThis.__catalogPrincipalReads,1);
 globalThis.__catalogSession.principal.permissions=[];const latest=await refreshMarketplaceSession(true);assert.equal(globalThis.__catalogPrincipalReads,2);assert.deepEqual(latest.session.principal.permissions,[]);
 }finally{delete globalThis.__catalogPrincipalReads;}
});
