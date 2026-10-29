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


 const locale=process.argv[2]||'zh-CN';await context.addInitScript(locale=>localStorage.setItem('pi-locale',locale),locale);
 let pluginError='Project resources must be trusted before modifying project plugins',skillError='HTTP 429',connectorError='Stdio Server 必须提供命令';
 const command='npm install @scope/pi-plugin --prefix F:\\image\\.pi\\npm --legacy-peer-deps failed with code 1';
 await context.addInitScript(()=>{window.EventSource=class extends EventTarget{static OPEN=1;static CLOSED=2;static CONNECTING=0;readyState=1;onopen=null;onmessage=null;onerror=null;constructor(url){super();this.url=String(url);setTimeout(()=>{this.onopen?.(new Event('open'));},50);}close(){this.readyState=2;}};});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/sessions/installed-project-0'){await route.fulfill({json:{sessionId:'installed-project-0',filePath:cwd+'/fixture.jsonl',info:{id:'installed-project-0',cwd,projectRoot:cwd,name:'错误本地化测试'},leafId:null,tree:[],context:{messages:[],entryIds:[],model:null},totalActiveMs:0}});return;}
  if(url.pathname==='/api/agent/installed-project-0'){const state={isStreaming:false,isPromptRunning:false,thinkingLevel:'medium',queuedMessages:[],messages:[]};await route.fulfill({json:req.method()==='POST'?{success:true,data:{}}:{running:false,state}});return;}
  if(url.pathname==='/api/plugins'&&req.method()==='POST'){await route.fulfill({status:403,json:{error:pluginError}});return;}
  if(url.pathname==='/api/skills/search'){await route.fulfill({status:429,json:{error:skillError}});return;}
  if(url.pathname==='/api/mcp/servers'&&req.method()==='POST'){await route.fulfill({status:400,json:{error:connectorError}});return;}
  await route.fallback();
 });
 await page.goto(base+'/?session=installed-project-0',{waitUntil:'domcontentloaded',timeout:60000});
 const zh=locale==='zh-CN';await page.getByRole('button',{name:zh?'扩展中心':'Extension Center',exact:true}).click();
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const active=()=>workspace.getByRole('region',{name:zh?/^市场扩展 ·/:/^Marketplace extensions ·/}).filter({visible:true});
 await sidebar.getByRole('button',{name:zh?'扩展来源':'Extension source',exact:true}).click();await page.getByRole('menuitem',{name:zh?'市场扩展':'Marketplace extensions',exact:true}).click();
 const category=async name=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();await category(zh?'插件':'Plugins');
 const plugin=()=>active().locator('[data-plugin-source-install]');await plugin().getByRole('textbox',{name:zh?'插件来源':'Plugin source',exact:true}).fill('npm:billion-context');await plugin().getByRole('button',{name:zh?'安装':'Install',exact:true}).click();
 const card=page.locator('.notification-card');await card.filter({hasText:zh?'当前项目尚未受信任':'Project resources must be trusted'}).waitFor();assert.equal(await card.count(),1);assert.equal(await card.locator('[data-slot="alert-title"]').textContent(),zh?'错误':'Error');
 await page.screenshot({path:`.tmp/extension-error-trust-${locale}.png`,animations:'disabled',timeout:60000});
 const close=async()=>{while(await card.count())await card.first().locator('[data-slot="alert-action"] button').click();};await close();
 if(zh){
  pluginError=command;await plugin().getByRole('button',{name:'安装',exact:true}).click();await card.filter({hasText:'安装命令执行失败（退出码 1）'}).waitFor();const details=card.locator('details');assert.equal(await details.getAttribute('open'),null);await details.locator('summary').click();assert.equal(await details.locator('pre').textContent(),command);await page.mouse.move(10,10);await page.waitForTimeout(3300);assert.equal(await card.count(),1);await page.screenshot({path:'.tmp/extension-error-command-details.png',animations:'disabled',timeout:60000});await close();
  pluginError='Upstream registry unavailable at https://example.test/registry';await plugin().getByRole('button',{name:'安装',exact:true}).click();await card.filter({hasText:'操作失败，请稍后重试'}).waitFor();await card.locator('summary').click();assert.equal(await card.locator('pre').textContent(),pluginError);await close();
  await category('技能');const skill=active().locator('[data-market-skill-search]');await skill.getByRole('textbox',{name:'技能名称或关键词',exact:true}).fill('browser');await skill.getByRole('button',{name:'搜索',exact:true}).click();await skill.getByRole('alert').getByText('请求过于频繁（HTTP 429），请稍后重试。',{exact:true}).waitFor();
  await category('连接器');const connector=active().locator('[data-market-connector-form]');await connector.getByRole('textbox',{name:'名称',exact:true}).fill('sample');await connector.getByRole('textbox',{name:'命令',exact:true}).fill('npx');await connector.getByRole('button',{name:'保存配置',exact:true}).click();await card.filter({hasText:'本地命令连接器必须填写启动命令。'}).waitFor();assert.equal(await card.count(),1);await close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({locale,trustErrorLocalized:zh,notificationTitleLocalized:true,noDuplicatePluginError:true,commandDetailsRetained:zh,expandedDetailsStayVisible:zh,skillSearchErrorLocalized:zh,connectorErrorLocalized:zh,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/extension-localization-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}finally{await browser.close();}
