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


 let running=false,saveDelay=0,statusRequests=0,configGets=0;const servers={global:[],project:[]},saves=[],reloads=[];
 await context.addInitScript(()=>{window.EventSource=class extends EventTarget{static OPEN=1;static CLOSED=2;static CONNECTING=0;readyState=1;onopen=null;onmessage=null;onerror=null;constructor(url){super();this.url=String(url);setTimeout(()=>{this.onopen?.(new Event('open'));const e=new MessageEvent('message',{data:JSON.stringify({type:'connected',isStreaming:false})});this.onmessage?.(e);this.dispatchEvent(e);},50);}close(){this.readyState=2;}};});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/sessions/installed-project-0'){await route.fulfill({json:{sessionId:'installed-project-0',filePath:cwd+'/fixture.jsonl',info:{id:'installed-project-0',cwd,projectRoot:cwd,name:'连接器布局测试'},leafId:null,tree:[],context:{messages:[],entryIds:[],model:null},totalActiveMs:0}});return;}
  if(url.pathname==='/api/agent/installed-project-0'){const state={isStreaming:running,isPromptRunning:running,thinkingLevel:'medium',queuedMessages:[],messages:[]};if(req.method()==='POST'){const command=req.postDataJSON();if(command.type==='reload')reloads.push(command);await route.fulfill({json:{success:true,data:command.type==='get_tools'?{tools:[]}:command.type==='get_state'?state:{}}});}else await route.fulfill({json:{running,state}});return;}
  if(url.pathname==='/api/mcp/status'){statusRequests++;await route.fulfill({json:{status:{sessionId:'installed-project-0',updatedAt:Date.now(),totalTools:0,servers:[]}}});return;}
  if(url.pathname==='/api/mcp/servers'){
   const body=req.method()==='POST'?req.postDataJSON():null,scope=body?.scope||url.searchParams.get('scope')||'project';
   if(body){saves.push(body);if(saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));if(body.server?.name==='fail-save'){await route.fulfill({status:500,json:{error:'连接器保存失败测试'}});return;}if(body.action==='set-disabled'){servers[scope].find(s=>s.name===body.previousName).disabled=body.disabled;}else{const server={...body.server,scope,state:'not-connected',toolCount:0};const index=servers[scope].findIndex(s=>s.name===body.previousName);if(body.action==='update'&&index>=0)servers[scope][index]=server;else servers[scope].push(server);}}
   else configGets++;
   await route.fulfill({json:{scope,configPath:scope==='global'?'C:/Users/QA/.config/mcp/mcp.json':cwd+'/.mcp.json',diagnostics:[],servers:servers[scope],managedServers:[],pluginServers:[]}});return;
  }await route.fallback();
 });
 await page.goto(base+'/?session=installed-project-0',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]'),active=()=>workspace.getByRole('region').filter({visible:true});
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();await sidebar.getByRole('navigation').getByRole('button',{name:'连接器',exact:true}).click();
 const form=()=>active().locator('[data-market-connector-form]'),field=name=>form().getByRole('textbox',{name,exact:true,includeHidden:true}),combo=name=>form().getByRole('combobox',{name,exact:true}),scope=label=>sidebar.getByRole('tab',{name:label,exact:true}).click(),save=()=>form().getByRole('button',{name:'保存配置',exact:true});
 await form().getByRole('heading',{name:'添加连接器',exact:true}).waitFor();assert.equal(await form().locator('select').count(),0);assert.equal(await form().locator('[data-slot="combobox-input"]').count(),2);assert.equal(await active().getByRole('button',{name:'刷新',exact:true}).count(),0);assert.equal(await active().getByRole('button',{name:'重载当前会话',exact:true}).count(),0);assert.equal(await active().getByRole('button',{name:'global',exact:true}).count(),0);assert.ok(await save().isDisabled());await form().getByText('保存到全局',{exact:true}).waitFor();
 const choose=async(label,option)=>{await combo(label).click();await page.getByRole('option',{name:option,exact:true}).click();};
 await field('名称').fill('global-stdio');await field('命令').fill('npx');const args=form().getByRole('textbox',{name:'参数（每行一个）',exact:true});await args.fill('-y');await args.press('End');await args.press('Enter');await args.press('a');assert.equal(await args.inputValue(),'-y\na');await args.fill('-y\n@scope/mcp-server\n');
 await choose('连接策略','会话启动时连接（Eager）');await form().getByText('会话启动或重载后立即连接，减少首次调用等待。',{exact:true}).waitFor();await form().locator('summary').filter({hasText:'工作目录'}).click();await field('工作目录').fill('E:/Work');
 await scope('项目');assert.equal(await field('名称').inputValue(),'');await field('名称').fill('project-http');await choose('传输方式','HTTP（远程服务）');assert.equal(await field('命令').count(),0);await field('服务地址').fill('https://example.test/mcp');await form().locator('summary').filter({hasText:'认证设置'}).click();await field('Bearer Token 环境变量').fill('MCP_TOKEN');await choose('连接策略','保持连接（Keep alive）');await form().getByRole('spinbutton',{name:'空闲断开（分钟）',exact:true}).fill('25');
 await scope('全局');assert.equal(await field('名称').inputValue(),'global-stdio');assert.equal(await field('命令').inputValue(),'npx');assert.equal(await args.inputValue(),'-y\n@scope/mcp-server\n');assert.equal(await combo('连接策略').inputValue(),'会话启动时连接（Eager）');await save().click();await form().getByRole('heading',{name:'编辑 global-stdio',exact:true}).waitFor();assert.equal(saves.at(-1).scope,'global');assert.deepEqual(saves.at(-1).server.args,['-y','@scope/mcp-server']);assert.equal(saves.at(-1).server.cwd,'E:/Work');assert.equal(saves.at(-1).server.lifecycle,'eager');
 // Preserve unsaved edits across scope switches, sidebar refresh and status polling.
 await field('命令').fill('node draft');const polls=statusRequests;await scope('项目');assert.equal(await field('名称').inputValue(),'project-http');assert.equal(await field('Bearer Token 环境变量').inputValue(),'MCP_TOKEN');assert.equal(await combo('连接策略').inputValue(),'保持连接（Keep alive）');await save().click();await form().getByRole('heading',{name:'编辑 project-http',exact:true}).waitFor();assert.equal(saves.at(-1).scope,'project');assert.equal(saves.at(-1).server.bearerTokenEnv,'MCP_TOKEN');assert.equal(saves.at(-1).server.idleTimeout,25);await scope('全局');assert.equal(await field('命令').inputValue(),'node draft');await page.waitForTimeout(3200);assert.ok(statusRequests>polls);assert.equal(await field('命令').inputValue(),'node draft');
 const reload=workspace.getByRole('button',{name:'重新加载',exact:true});running=true;await reload.click();await page.getByText('请等待当前运行完成后再重载。',{exact:true}).waitFor();assert.equal(reloads.length,0);running=false;const getsBefore=configGets;await reload.click();await page.waitForTimeout(300);assert.equal(reloads.length,1);assert.ok(configGets>getsBefore);assert.equal(await field('命令').inputValue(),'node draft');
 await form().getByRole('switch',{name:'禁用连接器',exact:true}).click();await form().getByRole('switch',{name:'启用连接器',exact:true}).waitFor();assert.equal(saves.at(-1).action,'set-disabled');assert.equal(saves.at(-1).scope,'global');
 // Installed navigation keeps the selected scope and existing fields editable.
 await sidebar.getByRole('button').filter({has:page.getByText('global-stdio',{exact:true})}).click();await form().getByRole('heading',{name:'编辑 global-stdio',exact:true}).waitFor();assert.equal(await field('命令').inputValue(),'npx');assert.equal(await combo('传输方式').inputValue(),'Stdio（本地命令）');
 await sidebar.getByRole('navigation').getByRole('button',{name:'连接器',exact:true}).click();await form().getByRole('button',{name:'添加连接器',exact:true}).click();await field('名称').fill('slow-save');await field('命令').fill('node');saveDelay=650;await save().click();await scope('项目');await form().getByRole('heading',{name:'编辑 project-http',exact:true}).waitFor();await page.waitForTimeout(900);saveDelay=0;assert.equal(await field('名称').inputValue(),'project-http');assert.equal(await field('服务地址').inputValue(),'https://example.test/mcp');assert.ok(servers.global.some(s=>s.name==='slow-save'));assert.ok(!servers.project.some(s=>s.name==='slow-save'));
 await scope('全局');assert.equal(await field('名称').inputValue(),'slow-save');await form().getByRole('button',{name:'添加连接器',exact:true}).click();await field('名称').fill('fail-save');await field('命令').fill('node');await save().click();await page.locator('.notification-card').filter({hasText:'连接器保存失败测试'}).waitFor();assert.equal(await field('名称').inputValue(),'fail-save');assert.equal(await field('命令').inputValue(),'node');
 await sidebar.getByRole('button').filter({has:page.getByText('global-stdio',{exact:true})}).click();await form().getByRole('heading',{name:'编辑 global-stdio',exact:true}).waitFor();servers.global.splice(servers.global.findIndex(server=>server.name==='global-stdio'),1);await reload.click();await form().waitFor({state:'detached'});assert.equal(await active().locator('[data-market-connector-form]').count(),0);await sidebar.getByRole('navigation').getByRole('button',{name:'连接器',exact:true}).click();assert.equal(await field('名称').inputValue(),'fail-save');while(await page.getByRole('button',{name:/^关闭通知/}).count())await page.getByRole('button',{name:/^关闭通知/}).first().click();await page.screenshot({path:'.tmp/connector-implemented-desktop.png',timeout:60000,animations:'disabled'});
 for(const width of [1440,1000,800,390,320]){await page.setViewportSize({width,height:1000});const geometry=await form().evaluate(el=>{const r=el.getBoundingClientRect(),main=el.closest('[data-notification-boundary]').getBoundingClientRect();return {left:r.left-main.left,right:main.right-r.right,overflow:el.scrollWidth>el.clientWidth};});assert.equal(geometry.left,24);assert.equal(geometry.right,24);assert.equal(geometry.overflow,false);}await page.screenshot({path:'.tmp/connector-implemented-mobile.png',timeout:60000,animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await choose('传输方式','HTTP（远程服务）');await combo('连接策略').click();await page.locator('[data-slot="combobox-content"]').waitFor();await combo('连接策略').press('ArrowDown');await combo('连接策略').press('Enter');await page.screenshot({path:'.tmp/connector-implemented-dark.png',timeout:60000,animations:'disabled'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({libraryDropdowns:true,scopeFromNavigation:true,separateDrafts:true,argumentsLineEditing:true,stdioAndHttpSave:true,configFieldsPreserved:true,pollingAndReloadPreserveDraft:true,streamingGuard:true,enableDisable:true,installedNavigation:true,pendingSaveCannotCrossScopes:true,errorKeepsDraft:true,responsive:true,dark:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/connector-implementation-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4500));}throw e;}finally{await browser.close();}
