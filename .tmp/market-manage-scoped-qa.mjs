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
let installationDelay=0,failInstallations=false;
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
  else if(url.pathname==='/api/organization-extensions/installations'){
   if(failInstallations){await route.fulfill({status:500,json:{error:'fixture failure'}});return;}
   data={items:managed.filter(item=>item.scope===url.searchParams.get('scope')&&item.type.toLowerCase()===url.searchParams.get('type')&&(url.searchParams.get('cwd')!==otherCwd||item.scope==='global'))};
   if(installationDelay&&url.searchParams.get('scope')==='global')await new Promise(r=>setTimeout(r,installationDelay));
  }
  else if(url.pathname.endsWith('/installation')){
   const id=url.pathname.split('/')[3];
   if(req.method()==='POST'){
    const body=req.postDataJSON();mutations.push(body);const target=managed.find(i=>i.capabilityId===id&&i.scope===body.scope);
    if(body.action==='prepare'){await route.fulfill({json:{preparationToken:'mock-plugin-token',expiresAt:Date.now()+60000,name:'组织插件',version:'2',skills:[],servers:[],requiresApproval:false}});return;}
    if(body.action==='uninstall'){managed.splice(managed.indexOf(target),1);for(let index=skills.length-1;index>=0;index--){const skill=skills[index];if(skill.organizationCapability?.capabilityId===id&&(skill.install?.scope??skill.sourceInfo.scope)===body.scope)skills.splice(index,1);}}
    if(body.action==='install'&&!target){const item=catalog.find(i=>i.id===id);managed.push({capabilityId:id,name:item.name,type:body.type,scope:body.scope,version:'2',installedAt:'',disabled:false});}
    if(body.action==='set-disabled')target.disabled=body.disabled;
    if(body.action==='update')target.version='2';
    if(body.action==='configure'){target.lifecycle=body.lifecycle;target.idleTimeout=body.idleTimeout;}
   }
   data={global:managed.filter(i=>i.capabilityId===id&&i.scope==='global'),project:managed.filter(i=>i.capabilityId===id&&i.scope==='project')};
  }
  else if(url.pathname==='/api/project-trust')data={trusted:true};
  else if(url.pathname==='/api/organization-extensions'&&catalogUnavailable){await route.fulfill({status:500,json:{error:'offline fixture'}});return;}
  else if(url.pathname==='/api/organization-extensions')data={items:catalog.filter(i=>i.type.toLowerCase()===url.searchParams.get('type'))};
  else if(url.pathname==='/api/organization-extensions/categories')data={items:[]};
  await route.fulfill({json:data});
 });
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();

 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true}),management=()=>panel().locator('[data-installed-management]');
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const scope=async(name)=>sidebar.getByRole('tab',{name,exact:true}).click();
 const entry=(name)=>panel().locator('.organization-extension-card,tbody tr').filter({has:page.getByText(name,{exact:true})});
 const action=async(name,label)=>{
  const button=entry(name).getByRole('button',{name:label,exact:true});await button.waitFor();
  await page.waitForFunction(el=>!el.disabled,await button.elementHandle());
  assert.equal(await entry(name).getByRole('button',{name:label==='管理'?'安装':'管理',exact:true}).count(),0);
  return button;
 };
 const checkManagement=async(name,scopeName)=>{
  await management().getByRole('heading',{name,exact:true}).waitFor();
  await management().getByText(scopeName,{exact:true}).waitFor();
  assert.equal(await sidebar.getByRole('tab',{name:scopeName,exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await sidebar.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
 };
 await category('插件');await (await action('组织插件','管理')).click();await checkManagement('组织插件','全局');
 assert.equal(mutations.length,0,'management navigation makes no install or preparation mutation');
 assert.ok(await management().getByRole('switch',{name:'启用组织插件',exact:true}).isVisible(),'disabled installations still have Manage');
 await category('插件');await scope('项目');await action('组织插件','安装');
 await panel().getByRole('button',{name:'表格视图',exact:true}).click();await action('组织插件','安装');
 await scope('全局');await (await action('组织插件','管理')).click();await checkManagement('组织插件','全局');
 await category('技能');await scope('全局');await action('组织技能','管理');await action('未加载的组织技能','安装');
 await scope('项目');await (await action('组织技能','管理')).click();await checkManagement('组织技能','项目');
 await category('技能');await action('未加载的组织技能','管理');
 await panel().getByRole('button',{name:'表格视图',exact:true}).click();await (await action('未加载的组织技能','管理')).click();await checkManagement('未加载的组织技能','项目');
 await category('连接器');await scope('项目');await action('组织 MCP','安装');
 await scope('全局');await (await action('组织 MCP','管理')).click();await checkManagement('组织 MCP','全局');
 assert.ok(await management().getByRole('button',{name:'配置',exact:true}).isVisible());
 await category('连接器');await panel().getByRole('button',{name:'表格视图',exact:true}).click();await (await action('组织 MCP','管理')).click();await checkManagement('组织 MCP','全局');
 assert.equal(mutations.length,0);
 // Completing an ordinary install immediately replaces Install with Manage, including records without timestamps.
 await category('技能');await scope('全局');await panel().getByRole('button',{name:'卡片视图',exact:true}).click();
 await panel().getByRole('textbox').fill('未加载');await (await action('未加载的组织技能','安装')).click();
 const dialog=page.getByRole('dialog');const confirm=dialog.getByRole('button',{name:'确认安装',exact:true});
 await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle());await confirm.click();await dialog.waitFor({state:'detached'});
 await (await action('未加载的组织技能','管理')).click();await checkManagement('未加载的组织技能','全局');
 assert.ok(mutations.some(m=>m.action==='install'&&m.type==='Skill'&&m.scope==='global'));
 await category('技能');assert.equal(await panel().getByRole('textbox').inputValue(),'未加载');await panel().getByRole('textbox').fill('');
 await (await action('组织技能','管理')).click();await checkManagement('组织技能','全局');await management().getByRole('button',{name:'卸载',exact:true}).click();
 await management().waitFor({state:'detached'});await category('技能');await action('组织技能','安装');await scope('项目');await action('组织技能','管理');
 // Pending and failed scope lookups must not enable duplicate installation or show another scope's Manage.
 await category('插件');await scope('项目');await action('组织插件','安装');installationDelay=700;await scope('全局');
 await entry('组织插件').getByRole('button',{name:'安装',exact:true}).waitFor();assert.ok(await entry('组织插件').getByRole('button',{name:'安装',exact:true}).isDisabled());
 await scope('项目');await action('组织插件','安装');await page.waitForTimeout(850);await action('组织插件','安装');installationDelay=0;
 failInstallations=true;await scope('全局');await panel().getByText('无法加载已安装能力，请稍后重试。',{exact:true}).waitFor();
 assert.ok(await entry('组织插件').getByRole('button',{name:'安装',exact:true}).isDisabled());failInstallations=false;await panel().getByRole('button',{name:'重试',exact:true}).click();await action('组织插件','管理');
 // A new project cannot offer Manage for an installation belonging to the old project.
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('button',{name:cwd,exact:true}).click();await page.getByRole('button').filter({has:page.getByText('Other',{exact:true})}).click();await page.getByRole('button',{name:otherCwd,exact:true}).waitFor();await page.getByRole('button',{name:'扩展中心',exact:true}).click();await category('技能');await scope('项目');await action('组织技能','安装');
 await scope('全局');await action('未加载的组织技能','管理');
 await category('插件');await panel().getByRole('button',{name:'卡片视图',exact:true}).click();
 while(await page.getByRole('button',{name:/^关闭通知：/}).count())await page.getByRole('button',{name:/^关闭通知：/}).first().click();
 await page.screenshot({path:'.tmp/market-manage-scoped.png'});
 await page.setViewportSize({width:390,height:844});await action('组织插件','管理');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await (await action('组织插件','管理')).click();await management().getByRole('heading',{name:'组织插件',exact:true}).waitFor();await management().getByText('全局',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scopedCardAndTableActions:true,skillConnectorPlugin:true,disabledCountsAsInstalled:true,directManagementNavigation:true,noInstallMutationOnManage:true,installAndUninstallRefresh:true,searchPreserved:true,staleScopeResponseIgnored:true,lookupFailureRetry:true,projectIsolation:true,mobileAndDark:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/market-manage-failure.png'});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}

