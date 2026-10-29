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



 skills.splice(0,skills.length);packages.splice(0,packages.length);managed.splice(0,managed.length);
 for(const scope of ['global','project'])skills.push(makeSkill('agent-browser',`${scope==='global'?'C:/Users/QA':cwd}/.agents/skills/agent-browser/SKILL.md`,{description:'Browser automation CLI.',sourceInfo:{scope:scope==='global'?'user':'project'},install:{scope,package:'vercel-labs/agent-browser@agent-browser',source:'vercel-labs/agent-browser',canCheckForUpdates:true,versionHash:'80161e681234'}}));
 for(const scope of ['global','project'])mcp[scope]={scope,configPath:scope+'.json',diagnostics:[],managedServers:[],pluginServers:[],servers:[{...server('shared-mcp',scope),transport:scope==='global'?'http':'stdio',url:scope==='global'?'https://example.test/mcp':undefined},server('keep-mcp',scope)]};
 let failSkill=true,failConnector=true,deleteDelay=500;const removals=[];
 await context.addInitScript(()=>{window.EventSource=class extends EventTarget{static OPEN=1;static CLOSED=2;static CONNECTING=0;readyState=1;onopen=null;onmessage=null;onerror=null;constructor(url){super();this.url=String(url);setTimeout(()=>this.onopen?.(new Event('open')),50);}close(){this.readyState=2;}};});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/sessions/installed-project-0'){await route.fulfill({json:{sessionId:'installed-project-0',filePath:cwd+'/fixture.jsonl',info:{id:'installed-project-0',cwd,projectRoot:cwd,name:'卸载功能测试'},leafId:null,tree:[],context:{messages:[],entryIds:[],model:null},totalActiveMs:0}});return;}
  if(url.pathname==='/api/agent/installed-project-0'){await route.fulfill({json:{running:false,state:{isStreaming:false,isPromptRunning:false,thinkingLevel:'medium',queuedMessages:[],messages:[]}}});return;}
  if(url.pathname==='/api/skills'){await route.fulfill({json:{skills:[],installedSkills:skills,diagnostics:[],projectResourcesLoaded:true}});return;}
  if(url.pathname==='/api/skills/uninstall'){
   const body=req.postDataJSON();removals.push({kind:'skill',...body});await new Promise(r=>setTimeout(r,deleteDelay));
   if(failSkill){await route.fulfill({status:500,json:{error:'技能卸载失败测试'}});return;}
   const i=skills.findIndex(s=>s.filePath===body.filePath&&s.install.scope===body.scope&&s.install.package===body.package);assert.ok(i>=0);skills.splice(i,1);await route.fulfill({json:{success:true}});return;
  }
  if(url.pathname==='/api/mcp/servers'){
   const body=req.method()==='POST'?req.postDataJSON():null,scope=body?.scope||url.searchParams.get('scope')||'project';
   if(body){assert.equal(body.action,'delete');removals.push({kind:'mcp',...body});await new Promise(r=>setTimeout(r,deleteDelay));if(failConnector){await route.fulfill({status:400,json:{error:'连接器卸载失败测试'}});return;}const i=mcp[scope].servers.findIndex(s=>s.name===body.previousName);assert.ok(i>=0);mcp[scope].servers.splice(i,1);}
   await route.fulfill({json:mcp[scope]});return;
  }await route.fallback();
 });
 await page.goto(base+'/?session=installed-project-0',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]'),active=()=>workspace.getByRole('region',{name:/^市场扩展 ·/}).filter({visible:true});
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();
 const category=async name=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click(),scope=async name=>sidebar.getByRole('tab',{name,exact:true}).click(),skill=()=>active().locator('[data-market-skill-management]'),form=()=>active().locator('[data-market-connector-form]'),close=async()=>{while(await page.getByRole('button',{name:/^关闭通知/}).count())await page.getByRole('button',{name:/^关闭通知/}).first().click();};
 await category('技能');await sidebar.getByRole('button',{name:'agent-browser',exact:true}).click();await skill().waitFor();await close();await page.screenshot({path:'.tmp/skill-uninstall-preview.png',animations:'disabled',timeout:60000});
 await skill().getByRole('button',{name:'卸载',exact:true}).click();await skill().getByRole('button',{name:'卸载中…',exact:true}).waitFor();assert.ok(await skill().getByRole('button',{name:'检查更新',exact:true}).isDisabled());await page.locator('.notification-card').filter({hasText:'技能卸载失败测试'}).waitFor();assert.equal(skills.length,2);await skill().getByRole('button',{name:'卸载',exact:true}).waitFor();
 failSkill=false;await close();await skill().getByRole('button',{name:'卸载',exact:true}).click();await skill().waitFor({state:'detached'});await active().getByText('此能力已不在当前范围的安装列表中。',{exact:true}).waitFor();assert.equal(skills.length,1);assert.equal(skills[0].install.scope,'project');assert.equal(removals.at(-1).scope,'global');assert.equal(removals.at(-1).cwd,cwd);assert.equal(await sidebar.getByRole('button',{name:'agent-browser',exact:true}).count(),0);
 await scope('项目');await sidebar.getByRole('button',{name:'agent-browser',exact:true}).click();await skill().getByRole('button',{name:'卸载',exact:true}).click();await skill().waitFor({state:'detached'});assert.equal(removals.at(-1).scope,'project');assert.equal(skills.length,0);
 await category('连接器');await sidebar.getByRole('button',{name:'shared-mcp',exact:true}).click();await form().getByRole('textbox',{name:'命令',exact:true}).waitFor();assert.equal(await form().getByRole('button',{name:'添加连接器',exact:true}).count(),0);await form().getByRole('textbox',{name:'名称',exact:true}).fill('unsaved-name');await close();await page.screenshot({path:'.tmp/connector-uninstall-preview.png',animations:'disabled',timeout:60000});
 await form().getByRole('button',{name:'卸载',exact:true}).click();await form().getByRole('button',{name:'卸载中…',exact:true}).waitFor();assert.ok(await form().getByRole('button',{name:'保存配置',exact:true}).isDisabled());await page.locator('.notification-card').filter({hasText:'连接器卸载失败测试'}).waitFor();assert.equal(await form().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'unsaved-name');assert.equal(removals.at(-1).previousName,'shared-mcp');assert.equal(mcp.project.servers.length,2);
 failConnector=false;await close();await form().getByRole('button',{name:'卸载',exact:true}).click();await form().waitFor({state:'detached'});assert.equal(mcp.project.servers.length,1);assert.equal(mcp.project.servers[0].name,'keep-mcp');assert.equal(mcp.global.servers.length,2);assert.equal(await sidebar.getByRole('button',{name:'shared-mcp',exact:true}).count(),0);await sidebar.getByRole('button',{name:'keep-mcp',exact:true}).waitFor();
 await scope('全局');await sidebar.getByRole('button',{name:'shared-mcp',exact:true}).click();await form().getByRole('textbox',{name:'服务地址',exact:true}).waitFor();await form().getByRole('button',{name:'卸载',exact:true}).click();await form().waitFor({state:'detached'});assert.equal(removals.at(-1).scope,'global');assert.equal(mcp.global.servers.length,1);
 // A delayed deletion must not clear an independently edited form in another scope.
 await sidebar.getByRole('button',{name:'keep-mcp',exact:true}).click();deleteDelay=1500;await form().getByRole('button',{name:'卸载',exact:true}).click();await scope('项目');await sidebar.getByRole('button',{name:'keep-mcp',exact:true}).click();await form().getByRole('textbox',{name:'名称',exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='keep-mcp'&&!e.disabled));await form().getByRole('textbox',{name:'名称',exact:true}).fill('project-draft');await new Promise(r=>setTimeout(r,350));assert.equal(await form().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'project-draft');assert.equal(mcp.project.servers.length,1);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({skillUninstall:true,connectorHttpAndStdioUninstall:true,failurePreservesDraft:true,pendingDisabled:true,exactSavedIdentity:true,bothScopes:true,sidebarRefresh:true,otherScopePreserved:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/uninstall-qa-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-5000));}throw e;}finally{await browser.close();}
