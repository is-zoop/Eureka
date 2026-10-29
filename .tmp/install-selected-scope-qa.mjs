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
    if(body.action==='prepare'){await route.fulfill({json:{preparationToken:'mock-plugin-token',expiresAt:Date.now()+60000,name:'组织插件',version:'2',skills:[],servers:[{name:'api',url:'https://example.test/mcp',auth:'haze'}],requiresApproval:true}});return;}
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
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();

 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true});
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const scope=async(name)=>sidebar.getByRole('tab',{name,exact:true}).click();
 const entry=name=>panel().locator('.organization-extension-card,tbody tr').filter({has:page.getByText(name,{exact:true})});
 const installButton=async(name)=>{const button=entry(name).getByRole('button',{name:'安装',exact:true});await button.waitFor();await page.waitForFunction(el=>!el.disabled,await button.elementHandle());return button;};
 const ready=async(name)=>entry(name).getByRole('button',{name:'管理',exact:true}).waitFor();
 await category('技能');await scope('全局');await (await installButton('待安装技能')).click();await ready('待安装技能');assert.equal(await page.getByRole('dialog').count(),0);assert.ok(mutations.some(m=>m.id==='5'&&m.action==='install'&&m.scope==='global'));
 await scope('项目');await panel().getByRole('button',{name:'表格视图',exact:true}).click();await (await installButton('待安装技能')).click();await ready('待安装技能');assert.equal(await page.getByRole('dialog').count(),0);assert.ok(mutations.some(m=>m.id==='5'&&m.action==='install'&&m.scope==='project'));
 // Details use the navigation scope too, even when another scope already has the capability.
 for(const [label,expected] of [['全局','global'],['项目','project']]){
  await scope(label);await entry('详情安装技能').getByRole('button',{name:'查看详情',exact:true}).click();const detail=page.locator('#extension-panel');await detail.getByRole('heading',{name:'详情安装技能',exact:true}).waitFor();const install=detail.getByRole('button',{name:'安装',exact:true});await install.waitFor();await install.focus();await page.keyboard.press('Enter');await detail.getByRole('button',{name:'管理',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.ok(mutations.some(m=>m.id==='8'&&m.action==='install'&&m.scope===expected));await detail.getByRole('button',{name:'关闭',exact:true}).click();
 }
 await category('连接器');
 for(const [label,expected] of [['全局','global'],['项目','project']]){
  await scope(label);await (await installButton('待安装连接器')).click();const dialog=page.getByRole('dialog');await dialog.getByRole('spinbutton').waitFor();assert.equal(await dialog.getByRole('radiogroup',{name:'安装范围',exact:true}).count(),0);assert.equal(await dialog.getByText('安装范围',{exact:true}).count(),0);await dialog.getByRole('spinbutton').fill('25');const confirm=dialog.getByRole('button',{name:'确认安装',exact:true});await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle());await confirm.click();await dialog.waitFor({state:'detached'});await ready('待安装连接器');assert.ok(mutations.some(m=>m.id==='6'&&m.action==='install'&&m.scope===expected&&m.idleTimeout===25));
 }
 await category('插件');
 for(const [label,expected] of [['全局','global'],['项目','project']]){
  await scope(label);await (await installButton('待安装插件')).click();const dialog=page.getByRole('dialog');const approval=dialog.getByRole('checkbox');await approval.waitFor();assert.equal(await dialog.getByRole('radio').count(),0);assert.equal(await dialog.getByText('安装范围',{exact:true}).count(),0);assert.ok(await dialog.getByRole('button',{name:'确认安装',exact:true}).isDisabled());await approval.check();await dialog.getByRole('button',{name:'确认安装',exact:true}).click();await dialog.waitFor({state:'detached'});await ready('待安装插件');assert.ok(mutations.some(m=>m.id==='7'&&m.action==='prepare'&&m.scope===expected));assert.ok(mutations.some(m=>m.id==='7'&&m.action==='install'&&m.scope===expected&&m.approveAddresses&&m.preparationToken==='mock-plugin-token'));
 }
 // An untrusted selected project produces an error, never a fallback global installation.
 projectTrusted=false;await category('技能');await scope('项目');await (await installButton('受限项目技能')).click();await page.getByText('Project resources must be trusted before installing project capabilities',{exact:true}).waitFor();assert.ok(!managed.some(i=>i.capabilityId==='9'));assert.ok(!mutations.some(m=>m.id==='9'&&m.scope==='global'));assert.equal(await page.getByRole('dialog').count(),0);projectTrusted=true;
 // Ordinary marketplace install forms inherit the same global/project navigation and hide duplicate scope controls.
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();await category('技能');
 for(const [label,expected] of [['全局','global'],['项目','project']]){
  await scope(label);assert.equal(await panel().getByRole('button',{name:'global',exact:true}).count(),0);assert.equal(await panel().getByRole('button',{name:'project',exact:true}).count(),0);const search=panel().getByRole('textbox').first();await search.fill('fixture');await search.press('Enter');const button=panel().getByRole('button',{name:'安装',exact:true});await button.waitFor();await button.click();await panel().getByRole('button',{name:/^✓/}).waitFor();assert.ok(mutations.some(m=>m.package==='qa/new-skill@new-skill'&&m.scope===expected));
 }
 await category('插件');
 for(const [label,expected] of [['全局','global'],['项目','project']]){
  await scope(label);assert.equal(await panel().getByRole('button',{name:'Global',exact:true}).count(),0);assert.equal(await panel().getByRole('button',{name:'Project',exact:true}).count(),0);await panel().locator('#plugin-source').fill(`npm:scope-${expected}`);await panel().getByRole('button',{name:'安装',exact:true}).click();await page.waitForTimeout(200);assert.ok(mutations.some(m=>m.action==='install'&&m.source===`npm:scope-${expected}`&&m.scope===expected));
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({skillDirectInstall:true,cardsAndTable:true,scopeFromNavigation:true,detailsScopePreserved:true,connectorConfigurationNoScopePrompt:true,pluginApprovalNoScopePrompt:true,noUntrustedProjectFallback:true,marketplaceSkillAndPluginScope:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/install-selected-scope-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
