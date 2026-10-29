import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='http://127.0.0.1:8080',cwd='E:/Eureka',otherCwd='E:/Other';
const managed=[
 {capabilityId:'1',name:'组织技能',type:'Skill',scope:'project',version:'1',installedAt:'2026-10-25',disabled:false},
 {capabilityId:'1',name:'组织技能',type:'Skill',scope:'global',version:'1',installedAt:'2026-10-25',disabled:false},
 {capabilityId:'2',name:'组织插件',type:'Plugin',scope:'global',version:'1',installedAt:'2026-10-25',disabled:true},
 {capabilityId:'3',name:'组织 MCP',type:'MCP',scope:'global',version:'1',installedAt:'2026-10-25',disabled:false},
 {capabilityId:'4',name:'未加载的组织技能',type:'Skill',scope:'project',version:'1',installedAt:'2026-10-25',disabled:true},
];
const makeSkill=(name,path,extra={})=>({name,description:`${name}的说明`,filePath:path,baseDir:path.replace('/SKILL.md',''),disableModelInvocation:false,sourceInfo:{scope:'project',source:'project'},...extra});
const skills=[makeSkill('组织技能',`${cwd}/.pi/skills/organization/SKILL.md`,{organizationCapability:{capabilityId:'1'}}),makeSkill('插件附属技能',`${cwd}/.pi/plugins/owned/SKILL.md`,{managedPlugin:{capabilityId:'2',name:'组织插件',scope:'global'}}),makeSkill('市场技能','C:/Skills/market/SKILL.md',{install:{scope:'global',package:'repo/market',source:'git',canCheckForUpdates:false}}),makeSkill('本地技能',`${cwd}/.pi/skills/local/SKILL.md`)];
const counts={extensions:1,skills:0,prompts:0,themes:0};
const packages=[{source:'npm:market-plugin',packageName:'市场插件',scope:'project',status:'installed',installedPath:`${cwd}/node_modules/market-plugin`,counts,resources:[],filtered:false,disabled:false,version:'1.0.0'},{source:'npm:not-installed',scope:'project',status:'missing',counts:{extensions:0,skills:0,prompts:0,themes:0},resources:[],disabled:false,filtered:false}];
const server=(name,scope)=>({name,scope,transport:'stdio',command:'node',args:['server.js'],state:'not-connected',toolCount:0,disabled:false});
const mcp={global:{scope:'global',configPath:'global.json',diagnostics:[],servers:[server('Global MCP','global')],managedServers:[{capabilityId:'3',name:'组织 MCP',scope:'global',version:'1',disabled:false,serverUrl:'https://example.test/mcp'}],pluginServers:[{capabilityId:'2',pluginName:'组织插件',name:'owned-server',url:'https://example.test/owned',disabled:true}]},project:{scope:'project',configPath:'project.json',diagnostics:[],servers:[server('Project MCP','project')],managedServers:[],pluginServers:[]}};
const catalog=managed.filter((item,index)=>managed.findIndex(candidate=>candidate.capabilityId===item.capabilityId)===index).map(item=>({id:item.capabilityId,name:item.name,type:item.type,description:'组织能力说明',author:'QA',department:null,category:null,categoryId:null,tags:[],calls:0,isFavorite:false,updatedAt:null,version:'2',connectType:null,serverUrl:null,versionHistory:[],iconUrl:null}));
let projectTrusted=true;
let failProjectMcp=false,delayGlobal=false,guestMode=false,catalogUnavailable=false;const mutations=[],errors=[];
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},locale:'zh-CN'});await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());let data={};
  if(url.pathname==='/api/marketplace-auth/session')data=guestMode?{guest:true,user:null}:{guest:false,user:{name:'QA',email:'qa@example.test'}};
  else if(url.pathname==='/api/sessions')data={sessions:[cwd,otherCwd].map((cwd,index)=>({id:`installed-project-${index}`,path:`${cwd}/fixture.jsonl`,cwd,projectRoot:cwd,name:`项目 ${index}`,firstMessage:'QA',created:new Date().toISOString(),modified:new Date().toISOString(),messageCount:0})),runningSessionIds:[]};
  else if(url.pathname==='/api/agent/running')data={runningSessionIds:[]};
  else if(url.pathname==='/api/cwd/validate')data={cwd};
  else if(url.pathname==='/api/worktrees')data={isGit:false,projectRoot:url.searchParams.get('cwd')||cwd,worktrees:[]};
  else if(url.pathname==='/api/models')data={models:{},modelList:[],defaultModel:null};
  else if(url.pathname.startsWith('/api/files/'))data={entries:[]};
  else if(url.pathname==='/api/skills/search')data={results:[{package:'qa/new-skill@new-skill',installs:'100'}]};
  else if(url.pathname==='/api/skills/install'){const body=req.postDataJSON();mutations.push(body);skills.push(makeSkill('新安装技能','C:/Skills/new/SKILL.md',{install:{scope:body.scope,package:body.package,source:'git',canCheckForUpdates:false}}));data={success:true};}
  else if(url.pathname==='/api/skills'){
   if(req.method()==='PATCH'){const body=req.postDataJSON();skills.find(s=>s.filePath===body.filePath).disableModelInvocation=body.disableModelInvocation;mutations.push(body);data={success:true};}
   else data={skills:url.searchParams.get('cwd')===otherCwd?skills.filter(skill=>skill.install?.scope==='global'):skills,diagnostics:[],projectResourcesLoaded:true};
  }
  else if(url.pathname==='/api/plugins'){
   if(req.method()==='POST'){const body=req.postDataJSON();mutations.push(body);const pkg=packages.find(p=>p.source===body.source&&p.scope===body.scope);if(body.action==='remove')packages.splice(packages.indexOf(pkg),1);else if(body.action==='disable'||body.action==='enable')pkg.disabled=body.action==='disable';}
   data={packages,totals:counts,diagnostics:[],projectResourcesLoaded:true};
  }
  else if(url.pathname==='/api/mcp/servers'){
   const scope=url.searchParams.get('scope')||'project';
   if(failProjectMcp&&scope==='project'){await route.fulfill({status:500,json:{error:'fixture failure'}});return;}
   if(delayGlobal&&scope==='global')await new Promise(r=>setTimeout(r,400));
   data=scope==='project'&&url.searchParams.get('cwd')===otherCwd?{...mcp.project,servers:[server('Other Project MCP','project')]}:mcp[scope];
  }
  else if(url.pathname==='/api/organization-extensions/installations')data={items:managed.filter(item=>item.scope===url.searchParams.get('scope')&&item.type.toLowerCase()===url.searchParams.get('type')&&(url.searchParams.get('cwd')!==otherCwd||item.scope==='global'))};
  else if(url.pathname.endsWith('/installation')){
   const id=url.pathname.split('/')[3];
   if(req.method()==='POST'){
    const body=req.postDataJSON();mutations.push({...body,id});if(!projectTrusted&&body.scope==='project'&&['install','update'].includes(body.action)){await route.fulfill({status:403,json:{error:'Project resources must be trusted before installing project capabilities'}});return;}const target=managed.find(i=>i.capabilityId===id&&i.scope===body.scope);
    if(body.action==='prepare'){await route.fulfill({json:{preparationToken:'mock-plugin-token',expiresAt:Date.now()+60000,name:'组织插件',version:'2',skills:['skills'],capabilities:{requestUserInput:true},composer:{selectionMode:'persistent'},servers:[{name:'api',url:'https://example.test/mcp',auth:'haze'}],requiresApproval:true}});return;}
    if(body.action==='uninstall'){managed.splice(managed.indexOf(target),1);for(let index=skills.length-1;index>=0;index--){const skill=skills[index];if(skill.organizationCapability?.capabilityId===id&&(skill.install?.scope??skill.sourceInfo.scope)===body.scope)skills.splice(index,1);}}
    if(body.action==='install'&&!target){const item=catalog.find(i=>i.id===id);managed.push({capabilityId:id,name:item.name,type:body.type,scope:body.scope,version:'2',installedAt:'2026-10-26',disabled:false});}
    if(body.action==='set-disabled')target.disabled=body.disabled;
    if(body.action==='update')target.version='2';
    if(body.action==='configure'){target.lifecycle=body.lifecycle;target.idleTimeout=body.idleTimeout;}
   }
   data={global:managed.filter(i=>i.capabilityId===id&&i.scope==='global'),project:managed.filter(i=>i.capabilityId===id&&i.scope==='project')};
  }
  else if(url.pathname==='/api/project-trust')data={trusted:projectTrusted};
  else if(url.pathname==='/api/organization-extensions'&&catalogUnavailable){await route.fulfill({status:500,json:{error:'offline fixture'}});return;}
  else if(url.pathname==='/api/organization-extensions')data={items:catalog.filter(i=>i.type.toLowerCase()===url.searchParams.get('type'))};
  else if(url.pathname==='/api/organization-extensions/categories')data={items:[]};
  await route.fulfill({json:data});
 });
 for(const [id,name,type] of [['5','待安装技能','Skill'],['6','待安装连接器','MCP'],['7','待安装插件','Plugin'],['8','详情安装技能','Skill'],['9','受限项目技能','Skill']])catalog.push({...catalog[0],id,name,type});

 let running=false,searchFailure=false,searchEmpty=false,searchDelay=0;const searches=[],reloadCommands=[],installs=[];
 const results=[{package:'qa/skills@find-skills',installs:'4M installs',url:'https://skills.sh/qa/skills/find-skills'},{package:'qa/skills@browser-act',installs:'14 installs',url:'https://skills.sh/qa/skills/browser-act'}];
 skills.push(makeSkill('find-skills','C:/Skills/find/SKILL.md',{disableModelInvocation:true,install:{scope:'global',package:'qa/skills@find-skills',source:'git',canCheckForUpdates:false}}));
 await context.addInitScript(()=>{window.EventSource=class extends EventTarget{static OPEN=1;static CLOSED=2;static CONNECTING=0;readyState=1;onopen=null;onmessage=null;onerror=null;constructor(url){super();this.url=String(url);setTimeout(()=>{this.onopen?.(new Event('open'));const e=new MessageEvent('message',{data:JSON.stringify({type:'connected',isStreaming:false})});this.onmessage?.(e);this.dispatchEvent(e);},50);}close(){this.readyState=2;}};});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/sessions/installed-project-0'){await route.fulfill({json:{sessionId:'installed-project-0',filePath:cwd+'/fixture.jsonl',info:{id:'installed-project-0',cwd,projectRoot:cwd,name:'技能页面测试'},leafId:null,tree:[],context:{messages:[],entryIds:[],model:null},totalActiveMs:0}});return;}
  if(url.pathname==='/api/agent/installed-project-0'){const state={isStreaming:running,isPromptRunning:running,thinkingLevel:'medium',queuedMessages:[],messages:[]};if(req.method()==='POST'){const command=req.postDataJSON();if(command.type==='reload'){reloadCommands.push(command);await new Promise(resolve=>setTimeout(resolve,250));}await route.fulfill({json:{success:true,data:command.type==='get_tools'?{tools:[]}:command.type==='get_state'?state:{}}});}else await route.fulfill({json:{running,state}});return;}
  if(url.pathname==='/api/skills/search'){searches.push(req.postDataJSON().query);if(searchDelay)await new Promise(resolve=>setTimeout(resolve,searchDelay));await route.fulfill(searchFailure?{status:500,json:{error:'技能搜索失败测试'}}:{json:{results:searchEmpty?[]:results}});return;}
  if(url.pathname==='/api/skills/install'){const body=req.postDataJSON();installs.push(body);if(body.package.endsWith('@install-fail')){await route.fulfill({status:500,json:{error:'技能安装失败测试'}});return;}skills.push(makeSkill(body.package.split('@')[1],cwd+'/'+body.scope+'/'+body.package.split('@')[1]+'/SKILL.md',{install:{scope:body.scope,package:body.package,source:'git',canCheckForUpdates:false}}));await route.fulfill({json:{success:true}});return;}
  await route.fallback();
 });
 await page.goto(base+'/?session=installed-project-0',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]'),active=()=>workspace.getByRole('region').filter({visible:true});
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();
 const category=async name=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();await category('技能');
 const form=()=>active().locator('[data-market-skill-search]'),input=()=>form().getByRole('textbox',{name:'技能名称或关键词',exact:true}),row=name=>form().locator('[data-market-skill-result]').filter({has:page.getByRole('heading',{name,exact:true})});
 await form().getByRole('heading',{name:'搜索技能',exact:true}).waitFor();const directory=()=>form().getByRole('link',{name:'浏览技能目录',exact:true});
 assert.equal(await directory().evaluate(el=>el.getBoundingClientRect().height),30);assert.ok(await directory().evaluate(el=>!!el.parentElement.querySelector('h2')));assert.equal(await workspace.locator('[data-notification-boundary="30"] > header a').count(),0);
 const reload=workspace.getByRole('button',{name:'重新加载',exact:true});assert.ok(await reload.isEnabled());assert.equal(await reload.evaluate(el=>!!el.closest('header')),true);
 assert.ok(await form().getByRole('heading',{name:'发现适合当前任务的技能',exact:true}).isVisible());assert.ok(await form().getByRole('button',{name:'搜索',exact:true}).isDisabled());
 searchDelay=350;await form().getByRole('button',{name:'测试',exact:true}).click();await form().getByRole('status',{name:'搜索中…',exact:true}).waitFor();await row('find-skills').waitFor();searchDelay=0;assert.equal(searches.at(-1),'testing');assert.equal(await form().locator('[data-market-skill-result]').count(),2);assert.ok(await row('find-skills').getByRole('button',{name:'管理',exact:true}).isEnabled());
 await row('find-skills').getByRole('button',{name:'管理',exact:true}).click();await active().getByText('find-skills',{exact:true}).waitFor();assert.equal(await sidebar.getByRole('button').filter({has:page.getByText('find-skills',{exact:true})}).getAttribute('aria-pressed'),'true');
 await category('技能');assert.equal(await input().inputValue(),'testing');await row('find-skills').getByRole('button',{name:'管理',exact:true}).waitFor();
 await sidebar.getByRole('tab',{name:'项目',exact:true}).click();await row('find-skills').getByRole('button',{name:'安装',exact:true}).waitFor();await row('find-skills').getByRole('button',{name:'安装',exact:true}).click();await row('find-skills').getByRole('button',{name:'管理',exact:true}).waitFor();assert.equal(installs.at(-1).scope,'project');await row('find-skills').getByRole('button',{name:'管理',exact:true}).click();await active().getByText('./project/find-skills/SKILL.md',{exact:true}).waitFor();await category('技能');
 await sidebar.getByRole('tab',{name:'全局',exact:true}).click();await row('browser-act').getByRole('button',{name:'安装',exact:true}).click();await row('browser-act').getByRole('button',{name:'管理',exact:true}).waitFor();assert.equal(installs.at(-1).scope,'global');
 const searchCount=searches.length;running=true;await reload.click();await page.getByText('请等待当前运行完成后再重载。',{exact:true}).waitFor();assert.equal(reloadCommands.length,0);running=false;await reload.click();assert.equal(await reload.getAttribute('aria-busy'),'true');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='重新加载'&&!el.disabled));assert.equal(reloadCommands.length,1);assert.equal(searches.length,searchCount);assert.equal(await input().inputValue(),'testing');assert.equal(await form().locator('[data-market-skill-result]').count(),2);
 searchEmpty=true;await input().fill('no-result');await input().press('Enter');await form().getByRole('heading',{name:'没有找到匹配的技能',exact:true}).waitFor();searchEmpty=false;searchFailure=true;await input().fill('error');await input().press('Enter');await form().getByRole('alert').getByText('技能搜索失败测试',{exact:true}).waitFor();searchFailure=false;await form().getByRole('button',{name:'重试',exact:true}).click();await row('find-skills').waitFor();
 await directory().waitFor();const skillPos=await directory().evaluate(el=>{const link=el.getBoundingClientRect(),title=el.parentElement.querySelector('h2').getBoundingClientRect(),body=el.closest('[data-market-skill-search]').getBoundingClientRect();return {top:link.top+link.height/2-title.top-title.height/2,right:body.right-link.right};});assert.equal(skillPos.top,0);assert.equal(skillPos.right,0);
 await page.locator('.notification-card').first().waitFor({state:'detached'});await page.screenshot({path:'.tmp/market-skill-implemented-desktop.png',timeout:60000,animations:'disabled'});
 await category('插件');const plugin=()=>active().locator('[data-plugin-source-install]'),pluginDirectory=plugin().getByRole('link',{name:'浏览插件目录',exact:true});await pluginDirectory.waitFor();assert.equal(await pluginDirectory.evaluate(el=>el.getBoundingClientRect().height),30);assert.equal(await pluginDirectory.locator('[data-plugin-directory-icon] path').count(),2);const pluginPos=await pluginDirectory.evaluate(el=>{const link=el.getBoundingClientRect(),title=el.parentElement.parentElement.querySelector('h2').getBoundingClientRect(),body=el.closest('[data-plugin-source-install]').getBoundingClientRect();return {top:link.top+link.height/2-title.top-title.height/2,right:body.right-link.right};});assert.equal(pluginPos.top,0);assert.equal(pluginPos.right,0);assert.ok(await reload.isEnabled());await plugin().getByRole('textbox',{name:'插件来源',exact:true}).fill('npm:kept-draft');await category('技能');await category('插件');assert.equal(await plugin().getByRole('textbox',{name:'插件来源',exact:true}).inputValue(),'npm:kept-draft');await page.screenshot({path:'.tmp/market-plugin-directory-moved.png',timeout:60000,animations:'disabled'});
 await category('技能');for(const width of [1440,1000,800,390,320]){await page.setViewportSize({width,height:960});const geometry=await form().evaluate(el=>{const r=el.getBoundingClientRect(),parent=el.closest('[data-notification-boundary]').getBoundingClientRect();return {left:r.left-parent.left,right:parent.right-r.right,overflow:el.scrollWidth>el.clientWidth};});assert.equal(geometry.left,24);assert.equal(geometry.right,24);assert.equal(geometry.overflow,false);assert.ok(await directory().evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.querySelector('h2').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<1;}));}await page.screenshot({path:'.tmp/market-skill-implemented-mobile.png',timeout:60000,animations:'disabled'});
 await page.setViewportSize({width:1440,height:960});await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:'.tmp/market-skill-implemented-dark.png',timeout:60000,animations:'disabled'});
 await page.goto(base+'/?cwd='+encodeURIComponent(cwd),{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'扩展中心',exact:true}).click();await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();await category('技能');assert.ok(await reload.isDisabled());
 assert.deepEqual(errors,[]);console.log(JSON.stringify({skillPreviewImplemented:true,searchSkeletonAndRetry:true,scopedInstallAndManage:true,disabledSkillManage:true,searchStateRetained:true,directoryAtContentTitle:true,pluginIconPreserved:true,reloadUsesExistingSessionCommand:true,streamingGuard:true,noSessionDisabled:true,responsive:true,dark:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/market-skill-implementation-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4500));}throw e;}finally{await browser.close();}
