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
 const workspace=page.locator('[data-app-page="extensions"]');
 const sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true});
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const source=async(name)=>{await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();};
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).first().waitFor();
 assert.equal(await workspace.getByRole('tab',{name:/^(已安装|市场)$/}).count(),0);
 for (const row of await sidebar.locator('li').all()) {
   const name=await row.getByRole('button').getAttribute('aria-label');assert.equal((await row.innerText()).trim(),name);
   assert.equal(await row.locator('svg').count(),1);
 }
 const catalogSearch=panel().getByRole('textbox');await catalogSearch.fill('组织');
 // Identical names in different scopes stay separate internally even with single-line labels.
 const sameName=sidebar.getByRole('button',{name:'组织技能',exact:true});
 await sameName.nth(0).focus();await page.keyboard.press('Enter');
 await panel().getByRole('button',{name:'管理',exact:true}).waitFor();
 assert.equal(await panel().locator('.organization-extension-card').count(),1);
 assert.equal(await panel().getByRole('heading',{name:'组织技能',exact:true}).count(),1);
 assert.equal(await page.locator('#extension-panel').isVisible(),false);
 assert.equal(await sidebar.getByRole('navigation').getByRole('button',{name:'技能',exact:true}).getAttribute('aria-pressed'),'false');
 await panel().getByRole('button',{name:'管理',exact:true}).click();await page.getByRole('menuitem',{name:'卸载',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-installed-capabilities] button[aria-label="组织技能"]').length===1);
 assert.ok(mutations.some(m=>m.action==='uninstall'&&m.scope==='global'));
 assert.ok(!mutations.some(m=>m.action==='uninstall'&&m.scope==='project'));
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).click();await panel().getByRole('button',{name:'管理',exact:true}).waitFor();
 // Details remain an explicit action; returning to management closes that separate panel with keyboard activation too.
 await panel().getByRole('button',{name:'查看详情',exact:true}).click();await page.locator('#extension-panel').getByRole('button',{name:'管理',exact:true}).waitFor();
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#extension-panel').isVisible(),false);
 await category('技能');assert.equal(await catalogSearch.inputValue(),'组织');assert.equal(await sidebar.getByRole('navigation').getByRole('button',{name:'技能',exact:true}).getAttribute('aria-pressed'),'true');
 await category('插件');await sidebar.getByRole('button',{name:'组织插件',exact:true}).click();await panel().getByRole('button',{name:'管理',exact:true}).waitFor();await page.screenshot({path:'.tmp/installed-management-organization.png'});
 await source('市场扩展');await category('技能');
 const marketSearch=panel().getByRole('textbox').first();await marketSearch.fill('retained-search');
 await sidebar.getByRole('button',{name:'市场技能',exact:true}).click();await panel().getByText('市场技能的说明',{exact:true}).waitFor();
 await panel().getByRole('button',{name:'在模型提示词中可见，点击以禁用',exact:true}).click();
 await sidebar.getByRole('button',{name:'刷新已安装能力',exact:true}).waitFor({state:'visible'});
 assert.equal((await sidebar.getByRole('button',{name:'市场技能',exact:true}).innerText()).trim(),'市场技能');
 await category('技能');assert.equal(await marketSearch.inputValue(),'retained-search');
 await category('插件');await sidebar.getByRole('button',{name:'市场插件',exact:true}).click();await panel().getByRole('button',{name:'移除',exact:true}).click();await sidebar.getByRole('button',{name:'市场插件',exact:true}).waitFor({state:'detached'});
 assert.ok(mutations.some(m=>m.action==='remove'&&m.scope==='project'));
 await category('MCP');const addName=panel().getByRole('textbox',{name:'名称',exact:true});await addName.fill('retained-mcp-draft');
 delayGlobal=true;await sidebar.getByRole('button',{name:'Global MCP',exact:true}).click();await sidebar.getByRole('button',{name:'Project MCP',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.mcp-config-form label input')).some(el=>el.checkVisibility()&&el.value==='Project MCP'));
 await page.waitForTimeout(450);assert.equal(await panel().getByRole('textbox',{name:'名称',exact:true}).inputValue(),'Project MCP');delayGlobal=false;
 await category('MCP');assert.equal(await addName.inputValue(),'retained-mcp-draft');
 await sidebar.getByRole('button',{name:'Project MCP',exact:true}).click();await page.screenshot({path:'.tmp/installed-management-mcp.png'});
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('button',{name:'扩展中心',exact:true}).click();assert.equal(await sidebar.getByRole('button',{name:'Project MCP',exact:true}).getAttribute('aria-pressed'),'true');
 await page.setViewportSize({width:390,height:844});await sidebar.getByRole('button',{name:'展开扩展导航',exact:true}).click();await sidebar.getByRole('button',{name:'Global MCP',exact:true}).click();
 assert.equal(await sidebar.getByRole('button',{name:'展开扩展导航',exact:true}).getAttribute('aria-expanded'),'false');
 await panel().getByRole('textbox',{name:'名称',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:'.tmp/installed-management-mobile-dark.png',animations:'disabled'});
 guestMode=true;await page.setViewportSize({width:1440,height:960});await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'扩展中心',exact:true}).click();await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();assert.ok(await page.getByRole('menuitem',{name:'组织扩展',exact:true}).isDisabled());
 assert.deepEqual(errors,[]);console.log(JSON.stringify({topTabsRemoved:true,singleLineIconsAndNames:true,installedSelectionManagesInline:true,organizationScopeRetained:true,keyboardSelectionClosesDetails:true,categoriesReturnToCatalog:true,marketSkillToggle:true,pluginRemoval:true,searchAndMcpDraftPreserved:true,mcpScopeRaceSafe:true,mobileDarkAndGuest:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/installed-sidebar-failure.png'});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
