import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {setTimeout as delay} from 'node:timers/promises';import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{tsconfigPaths:true,alias:{'server-only':resolve('node_modules/next/dist/compiled/server-only/empty.js')}});
const {parseScheduleTiming,nextScheduleAt}=await jiti.import('./automation-schedule.ts'),{createSchedule,listSchedules,changeSchedule,tickSchedules}=await jiti.import('./automation-scheduler.ts');
const {localAutomationContext}=await jiti.import('./automation-local-context.ts'),{LocalAutomationAppStore}=await jiti.import('./automation-local-store.ts');
const {parseAutomationAppArchive,inspectAutomationFiles}=await jiti.import('./automation-app-package.ts'),{fileAutomationExample}=await jiti.import('./automation-app-example.ts');
const {getAppRun,appRunValue,listAppRuns,stopAppRun,readAppConfiguration}=await jiti.import('./automation-app-runtime.ts'),{appHasLease,takeAppLease}=await jiti.import('./automation-app-lease.ts'),{relativeAppDate}=await jiti.import('./automation-form.ts');
test('local schedule recurrence validates timing and crosses day/week boundaries without rerunning the same slot',()=>{
 const at=new Date(2026,10,16,9,0,0).getTime();assert.equal(new Date(nextScheduleAt({kind:'daily',time:'09:00'},at)).getDate(),17);
 assert.equal(new Date(nextScheduleAt({kind:'weekly',time:'09:00',days:[1]},at)).getDate(),23);
 assert.equal(nextScheduleAt({kind:'once',at:new Date(at).toISOString()},at),null);assert.equal(Date.parse(nextScheduleAt({kind:'interval',minutes:5},at)),at+300000);
 for(const value of [{kind:'daily',time:'25:00'},{kind:'interval',minutes:0},{kind:'weekly',time:'09:00',days:[]},{kind:'once',at:'no'},{kind:'daily',time:'09:00',extra:true}])assert.throws(()=>parseScheduleTiming(value));
});
async function fixture(work){
 const base=await mkdtemp(join(tmpdir(),'eureka-scheduler-')),keys=['PI_CODING_AGENT_DIR','EUREKA_AUTH_HAZE_ISSUER','EUREKA_AUTH_CLIENT_ID','EUREKA_AUTH_REDIRECT_URI','EUREKA_AUTH_SESSION_SECRET'],prior=new Map(keys.map(k=>[k,process.env[k]]));for(const key of keys)delete process.env[key];process.env.PI_CODING_AGENT_DIR=base;
 const local=localAutomationContext(base),store=new LocalAutomationAppStore(base,local.ownerKey,local.assertIdentity),auth={...local,store,assertExecution:()=>{}};
 const files=parseAutomationAppArchive(fileAutomationExample()).files;files.set('ui.json',Buffer.from(JSON.stringify({schemaVersion:1,fields:[{id:'day',label:'日期',type:'date',required:true}],buttons:[{id:'run',label:'Run',action:'run'}],results:{columns:[]}})));files.set('workflow.json',Buffer.from(JSON.stringify({schemaVersion:1,nodes:[{id:'local',label:'Local',kind:'script'}],edges:[]})));files.set('scripts/main.mjs',Buffer.from(`export default async ctx=>ctx.step('local',null,async()=>({day:ctx.params.day}));`));
 const install=await store.install(inspectAutomationFiles(files),0),now=Date.now(),input={appId:install.id,version:'1.0.0',actionId:'run',values:{day:'2020-01-01'},dates:{day:'yesterday'},timing:{kind:'interval',minutes:1}};input.version=(await store.detail(install.id)).manifest.version;
 const terminal=async id=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const run=await getAppRun(auth,install.id,id);if(!['running','waiting-user','waiting-browser','cancelling'].includes(run.status)&&!await appHasLease(store.dataDirectory(install.id)))return run;await delay(30);}throw new Error('scheduled fixture timed out');};
 try{await work({base,auth,store,install,now,input,terminal});}finally{for(const run of await listAppRuns(auth,install.id)){if(['running','waiting-user','waiting-browser','cancelling'].includes(run.status))await stopAppRun(auth,install.id,run.id);}const deadline=Date.now()+5000;while(await appHasLease(store.dataDirectory(install.id))&&Date.now()<deadline)await delay(30);for(const[k,v]of prior){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(base,{recursive:true,force:true});}
}
test('guest schedules claim once, recompute relative dates, pin version and do not overwrite manual parameters',async()=>fixture(async({auth,store,install,now,input,terminal})=>{
 const plan=await createSchedule(auth,input,now);await tickSchedules(now+60000);const claimed=(await listSchedules(auth))[0];assert.equal(claimed.history[0].status,'started');const id=claimed.history[0].runId,run=await terminal(id);assert.equal(run.status,'completed',run.error);assert.equal(run.scheduleId,plan.id);assert.equal(run.version,input.version);assert.equal((await appRunValue(auth,install.id,id,run.resultRef)).day,relativeAppDate('yesterday',new Date(now+60000)));assert.equal((await readAppConfiguration(auth,install.id)).revision,0);
 await tickSchedules(now+60000);assert.equal((await listAppRuns(auth,install.id)).length,1);assert.equal((await listSchedules(auth))[0].history.length,1);
 const exported=parseAutomationAppArchive((await store.export(install.id)).bytes);assert.equal([...exported.files.keys()].some(f=>f.includes('plans.json')),false);
}));
test('missed startup and sleeping occurrences are recorded without backfilling; overlapping work is skipped',async()=>fixture(async({auth,store,install,now,input})=>{
 await createSchedule(auth,input,now);await tickSchedules(now+60000,true);assert.equal((await listSchedules(auth))[0].history[0].status,'missed');assert.equal((await listAppRuns(auth,install.id)).length,0);
 await tickSchedules(now+240000);assert.equal((await listSchedules(auth))[0].history[0].status,'missed');
 await store.ensureDataDirectory(store.dataDirectory(install.id));const release=await takeAppLease(store.dataDirectory(install.id));try{await tickSchedules(now+300000);const plan=(await listSchedules(auth))[0];assert.equal(plan.history[0].status,'skipped');assert.equal(plan.enabled,true);}finally{await release();}
}));
test('changed browser configuration pauses schedules and optimistic plan edits reject stale revisions',async()=>fixture(async({base,auth,store,install,now,input})=>{
 const plan=await createSchedule(auth,input,now);const paused=await changeSchedule(auth,plan.id,plan.revision,'pause',now);await assert.rejects(changeSchedule(auth,plan.id,plan.revision,'enable',now),/变化/);await changeSchedule(auth,plan.id,paused.revision,'enable',now);
 await store.privateJson(join(store.dataDirectory(install.id),'browser-settings.json'),{schemaVersion:1,environments:{shop:'changed'}});await writeFile(join(base,'eureka-haze-runtime-session.json'),JSON.stringify({fixture:'unrelated-cloud-login'}));await tickSchedules(now+60000);
 const changed=(await listSchedules(auth))[0];assert.equal(changed.enabled,false);assert.match(changed.history[0].message,/配置已变化/);assert.equal((await listAppRuns(auth,install.id)).length,0);
}));
test('once-only missed runs remain consumed and uninstalling an app stops future dispatch',async()=>fixture(async({auth,store,install,now,input})=>{
 await createSchedule(auth,{...input,timing:{kind:'once',at:new Date(now+60000).toISOString()}},now);await tickSchedules(now+60000,true);const plan=(await listSchedules(auth))[0];assert.equal(plan.enabled,false);await assert.rejects(changeSchedule(auth,plan.id,plan.revision,'enable',now+61000),/时间已过去/);
 await createSchedule(auth,input,now);await store.uninstall(install.id,install.revision);await tickSchedules(now+60000);assert.equal((await listSchedules(auth)).find(p=>p.id!==plan.id).enabled,false);
}));
test('installing a newer version does not silently change a plan pinned to the previous package',async()=>fixture(async({auth,store,install,now,input,terminal})=>{
 await createSchedule(auth,input,now);const {withAutomationAppVersion}=await jiti.import('./automation-app-metadata.ts');
 const original=parseAutomationAppArchive((await store.export(install.id)).bytes),updated=withAutomationAppVersion(original,'2.0.0');updated.files.set('scripts/main.mjs',Buffer.from(`export default async ctx=>ctx.step('local',null,async()=>({wrongVersion:true}));`));await store.install(inspectAutomationFiles(updated.files),install.revision);
 await tickSchedules(now+60000);const plan=(await listSchedules(auth))[0];assert.equal(plan.history[0].status,'started');const run=await terminal(plan.history[0].runId);assert.equal(run.status,'completed',run.error);assert.equal(run.version,input.version);assert.equal((await appRunValue(auth,install.id,run.id,run.resultRef)).wrongVersion,undefined);assert.equal((await store.detail(install.id)).manifest.version,'2.0.0');
}));
