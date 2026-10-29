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
  else if(url.pathname==='/api/cwd/validate')data={cwd:req.postDataJSON()?.cwd??cwd};
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
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const project=sidebar.locator('header').getByText('Eureka',{exact:true});await project.waitFor();
 assert.equal(await workspace.getByText('Eureka',{exact:true}).count(),1);
 assert.equal(await sidebar.locator('header').getByRole('button',{name:'搜索已安装能力…',exact:true}).count(),0);
 assert.equal(await sidebar.getByRole('button',{name:'刷新已安装能力',exact:true}).count(),0);
 const initialRect=await project.boundingBox();assert.ok(initialRect.y<64);
 const projectStyle=await project.evaluate(el=>({color:getComputedStyle(el).color,dim:getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim(),fontSize:getComputedStyle(el).fontSize}));
 assert.equal(projectStyle.fontSize,'11px');
 assert.equal(await project.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--text-dim)';el.append(probe);const matched=getComputedStyle(el).color===getComputedStyle(probe).color;probe.remove();return matched;}),true);
 const scope=async(name)=>sidebar.getByRole('tab',{name,exact:true}).click();
 await scope('项目');await sidebar.getByRole('button',{name:'未加载的组织技能',exact:true}).waitFor();assert.equal(await sidebar.locator('li').count(),2);
 const heading=sidebar.getByRole('heading',{name:/^已安装/}).locator('..'),searchButton=sidebar.getByRole('button',{name:'搜索已安装能力…',exact:true});
 assert.ok(await heading.getByRole('button',{name:'搜索已安装能力…',exact:true}).isVisible());
 const before=await heading.boundingBox();await searchButton.click();
 const input=sidebar.getByRole('textbox',{name:'搜索已安装能力…',exact:true});assert.ok(await input.evaluate(el=>el===document.activeElement));
 const searchRect=await input.locator('..').boundingBox();assert.equal(searchRect.y,before.y);assert.equal(searchRect.height,36);
 const installedStyle=await input.evaluate(el=>({border:getComputedStyle(el).borderWidth,font:getComputedStyle(el).fontSize,bg:getComputedStyle(el).backgroundColor}));assert.equal(installedStyle.border,'0px');assert.equal(installedStyle.font,'13px');assert.equal(installedStyle.bg,'rgba(0, 0, 0, 0)');
 await input.fill('未加载');assert.equal(await sidebar.locator('li').count(),1);await input.press('Escape');await searchButton.waitFor();assert.equal(await sidebar.locator('li').count(),2);
 await searchButton.click();assert.equal(await input.inputValue(),'');await input.fill('不存在的能力');await sidebar.getByText('没有找到符合条件的组织扩展。',{exact:true}).waitFor();await sidebar.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await sidebar.locator('li').count(),2);
 await searchButton.click();await input.fill('未加载');await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('button',{name:'扩展中心',exact:true}).click();assert.equal(await input.inputValue(),'未加载');await input.press('Escape');
 // The input presentation matches the existing session search.
 await page.getByRole('button',{name:'主页',exact:true}).click();await page.getByRole('button',{name:'搜索任务',exact:true}).click();
 const sessionInput=page.getByRole('textbox',{name:'搜索任务',exact:true});
 const sessionStyle=await sessionInput.evaluate(el=>({border:getComputedStyle(el).borderWidth,font:getComputedStyle(el).fontSize,bg:getComputedStyle(el).backgroundColor}));assert.deepEqual(installedStyle,sessionStyle);await sessionInput.press('Escape');
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();await page.screenshot({path:'.tmp/installed-project-search-desktop.png'});
 await page.setViewportSize({width:390,height:844});await sidebar.getByRole('button',{name:'展开扩展导航',exact:true}).click();await searchButton.click();assert.ok(await input.evaluate(el=>el===document.activeElement));await input.fill('组织技能');
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:'.tmp/installed-project-search-mobile-dark.png',animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // A long project name stays in the header without forcing horizontal overflow.
 await page.setViewportSize({width:1440,height:960});await page.goto(`${base}/?cwd=${encodeURIComponent('E:/a-very-long-project-name-for-overflow-checking')}`,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const longProject=sidebar.locator('header').getByText('a-very-long-project-name-for-overflow-checking',{exact:true});await longProject.waitFor();assert.equal(await longProject.evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({refreshRemoved:true,searchMovedToInstalledHeading:true,inlineSearchMatchesSessions:true,searchFocusFilterEscapeAndClose:true,searchPreserved:true,projectMovedAndDimmed:true,duplicateProjectHeaderRemoved:true,longNameTruncated:true,mobileDarkNoOverflow:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/installed-sidebar-failure.png'});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
