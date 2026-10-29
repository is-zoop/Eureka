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
const catalog=managed.filter((item,index)=>managed.findIndex(candidate=>candidate.capabilityId===item.capabilityId)===index).map(item=>({id:item.capabilityId,name:item.name,type:item.type,description:'组织能力说明',author:'QA',department:null,category:null,categoryId:null,tags:[],calls:0,isFavorite:false,updatedAt:null,version:'1',connectType:null,serverUrl:null,versionHistory:[],iconUrl:null}));
let failProjectMcp=false,delayGlobal=false,guestMode=false;const mutations=[],errors=[];
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
   if(req.method()==='POST'){const body=req.postDataJSON();mutations.push(body);if(body.action==='uninstall'){const index=managed.findIndex(i=>i.capabilityId===id&&i.scope===body.scope);managed.splice(index,1);}}
   data={global:managed.filter(i=>i.capabilityId===id&&i.scope==='global'),project:managed.filter(i=>i.capabilityId===id&&i.scope==='project')};
  }
  else if(url.pathname==='/api/organization-extensions')data={items:catalog.filter(i=>i.type.toLowerCase()===url.searchParams.get('type'))};
  else if(url.pathname==='/api/organization-extensions/categories')data={items:[]};
  await route.fulfill({json:data});
 });
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const sidebar=page.locator('[data-installed-capabilities]');
 const workspace=page.locator('[data-app-page="extensions"]');
 const panel=()=>workspace.getByRole('tabpanel').filter({visible:true});
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const source=async(name)=>{await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
 const view=async(name)=>workspace.getByRole('tab',{name,exact:true}).click();
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).first().waitFor();
 assert.equal(await sidebar.locator('li').count(),3);
 await category('插件');await sidebar.getByRole('button',{name:'组织插件',exact:true}).waitFor();assert.equal(await sidebar.locator('li').count(),1);
 await category('MCP');await sidebar.getByRole('button',{name:'组织 MCP',exact:true}).waitFor();assert.equal(await sidebar.locator('li').count(),1);
 await category('技能');await panel().getByRole('textbox').fill('组织');
 await view('已安装');await panel().getByRole('heading',{name:'组织技能',exact:true}).waitFor();
 assert.equal(await panel().locator('.organization-extension-card').count(),1);
 await panel().getByRole('tab',{name:'项目安装',exact:true}).click();await panel().getByRole('heading',{name:'未加载的组织技能',exact:true}).waitFor();
 assert.equal(await panel().locator('.organization-extension-card').count(),2);
 await view('市场');assert.equal(await panel().getByRole('textbox').inputValue(),'组织');
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).filter({hasText:'全局'}).click();
 await page.locator('#extension-panel').getByRole('button',{name:'管理',exact:true}).focus();await page.keyboard.press('Enter');
 await page.getByRole('menuitem',{name:'卸载',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-installed-capabilities] button[aria-label="组织技能"]').length===1);
 assert.ok(mutations.some(m=>m.action==='uninstall'&&m.scope==='global'));
 await page.locator('#extension-panel').getByRole('button',{name:'关闭',exact:true}).click();
 await source('市场扩展');await view('市场');
 assert.equal(await sidebar.locator('li').count(),2);
 assert.equal(await sidebar.getByRole('button',{name:'组织技能',exact:true}).count(),0);
 const marketSearch=panel().getByRole('textbox').first();await marketSearch.fill('skills-search-draft');
 await sidebar.getByRole('button',{name:'市场技能',exact:true}).click();await panel().getByText('市场技能的说明',{exact:true}).waitFor();
 await panel().getByRole('button',{name:'在模型提示词中可见，点击以禁用',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-installed-capabilities] button[aria-label="市场技能"]')?.textContent.includes('已禁用'));
 await view('市场');assert.equal(await marketSearch.inputValue(),'skills-search-draft');
 await panel().getByRole('button',{name:'搜索',exact:true}).click();await panel().getByRole('button',{name:'安装',exact:true}).click();
 await sidebar.getByRole('button',{name:'新安装技能',exact:true}).waitFor();await view('已安装');await sidebar.getByRole('button',{name:'新安装技能',exact:true}).click();await panel().getByText('新安装技能的说明',{exact:true}).waitFor();
 await sidebar.getByRole('button',{name:'搜索已安装能力…',exact:true}).click();
 const search=sidebar.getByRole('textbox',{name:'搜索已安装能力…',exact:true});await search.fill('本地');assert.equal(await sidebar.locator('li').count(),1);await search.fill('');
 await category('插件');await sidebar.getByRole('button',{name:'市场插件',exact:true}).waitFor();
 await view('市场');const pluginSource=panel().getByRole('textbox',{name:'Source',exact:true});await pluginSource.fill('npm:unsaved-plugin');
 await sidebar.getByRole('button',{name:'市场插件',exact:true}).click();await panel().getByRole('button',{name:'移除',exact:true}).click();
 await sidebar.getByRole('button',{name:'市场插件',exact:true}).waitFor({state:'detached'});
 assert.ok(mutations.some(m=>m.action==='remove'&&m.source==='npm:market-plugin'&&m.scope==='project'));
 await view('市场');assert.equal(await pluginSource.inputValue(),'npm:unsaved-plugin');
 await category('MCP');await sidebar.getByRole('button',{name:'Project MCP',exact:true}).waitFor();
 await view('市场');const newMcpName=panel().getByRole('textbox',{name:'名称',exact:true});await newMcpName.fill('unsaved-new-mcp');
 delayGlobal=true;await sidebar.getByRole('button',{name:'Global MCP',exact:true}).click();await sidebar.getByRole('button',{name:'Project MCP',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.mcp-config-form label input')).some(el=>el.checkVisibility()&&el.value==='Project MCP'));
 await page.waitForTimeout(500);assert.equal(await panel().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'Project MCP');delayGlobal=false;
 await panel().getByRole('textbox',{name:'名称',exact:true}).fill('edited-project-mcp');
 await view('市场');assert.equal(await newMcpName.inputValue(),'unsaved-new-mcp');await view('已安装');assert.equal(await panel().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'edited-project-mcp');
 await sidebar.getByRole('button',{name:'Project MCP',exact:true}).click();await panel().getByRole('textbox',{name:'名称',exact:true}).waitFor();assert.equal(await panel().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'Project MCP');
 await page.screenshot({path:'.tmp/extensions-redesign-desktop.png'});
 failProjectMcp=true;await sidebar.getByRole('button',{name:'刷新已安装能力',exact:true}).click();await sidebar.getByText('部分能力加载失败，可点击刷新重试。',{exact:true}).waitFor();
 assert.ok(await sidebar.getByRole('button',{name:'Global MCP',exact:true}).isVisible());
 failProjectMcp=false;await sidebar.getByRole('button',{name:'刷新已安装能力',exact:true}).click();await sidebar.getByRole('button',{name:'Project MCP',exact:true}).waitFor();
 await search.fill('MCP');await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('button',{name:'扩展中心',exact:true}).click();assert.equal(await search.inputValue(),'MCP');await search.fill('');
 // Keep searches and configuration drafts when visiting another source/category.
 await source('组织扩展');await category('技能');await view('市场');assert.equal(await panel().getByRole('textbox').inputValue(),'组织');
 await source('市场扩展');await category('技能');await view('市场');assert.equal(await marketSearch.inputValue(),'skills-search-draft');
 await page.screenshot({path:'.tmp/extensions-redesign-skills.png'});
 await page.setViewportSize({width:390,height:844});const toggle=sidebar.getByRole('button',{name:'展开扩展导航',exact:true});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await page.waitForTimeout(400);await page.screenshot({path:'.tmp/extensions-redesign-mobile.png'});
 await sidebar.getByRole('button',{name:'本地技能',exact:true}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:'.tmp/extensions-redesign-mobile-dark.png',animations:'disabled'});
 await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await page.getByRole('button',{name:'主页',exact:true}).click();
 await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await page.getByRole('button',{name:cwd,exact:true}).click();await page.getByRole('button').filter({has:page.getByText('Other',{exact:true})}).click();
 await page.getByRole('button',{name:otherCwd,exact:true}).waitFor();if(await page.locator('#session-sidebar').evaluate(el=>el.inert))await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await page.getByRole('button',{name:'扩展中心',exact:true}).click();await toggle.click();await source('市场扩展');await category('MCP');await sidebar.getByRole('button',{name:'Other Project MCP',exact:true}).waitFor();
 assert.equal(await sidebar.getByRole('button',{name:'Project MCP',exact:true}).count(),0);assert.ok(await sidebar.getByRole('button',{name:'Global MCP',exact:true}).isVisible());
 await sidebar.getByRole('button',{name:'搜索已安装能力…',exact:true}).click();assert.equal(await search.inputValue(),'');
 guestMode=true;await page.setViewportSize({width:1440,height:960});await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();assert.ok(await page.getByRole('menuitem',{name:'组织扩展',exact:true}).isDisabled());assert.equal(await page.getByRole('menuitem',{name:'组织扩展',exact:true}).getAttribute('title'),'登录账号后可使用企业扩展');await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({sourceAndCategoryFilters:true,organizationInstalledScopes:true,marketAndInstalledViews:true,skillToggleRefresh:true,pluginRemovalRefresh:true,mcpScopeRaceSafe:true,searchAndDraftsRetained:true,organizationScopeAction:true,partialFailureRecovery:true,mobileAndDark:true,projectReset:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/installed-sidebar-failure.png'});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
