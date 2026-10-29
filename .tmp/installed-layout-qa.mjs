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
    const body=req.postDataJSON();mutations.push(body);const target=managed.find(i=>i.capabilityId===id&&i.scope===body.scope);
    if(body.action==='prepare'){await route.fulfill({json:{preparationToken:'mock-plugin-token',expiresAt:Date.now()+60000,name:'组织插件',version:'2',skills:[],servers:[],requiresApproval:false}});return;}
    if(body.action==='uninstall'){managed.splice(managed.indexOf(target),1);for(let index=skills.length-1;index>=0;index--){const skill=skills[index];if(skill.organizationCapability?.capabilityId===id&&(skill.install?.scope??skill.sourceInfo.scope)===body.scope)skills.splice(index,1);}}
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
 for(const item of catalog){item.tags=['提问方式','提示词优化'];item.department='系统';item.category='数据分析';}
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();

 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true}),management=()=>panel().locator('[data-installed-management]'),runtime=()=>management().locator('[data-install-runtime]');
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const scope=async(name)=>sidebar.getByRole('tab',{name,exact:true}).click();
 const open=async(type,name)=>{await category(type);await sidebar.getByRole('button',{name,exact:true}).click();await runtime().waitFor();};
 const hint='启用、停用、更新或卸载后，请重新加载以应用到当前会话。';
 const help=()=>runtime().getByRole('button',{name:'安装与运行说明',exact:true});
 const tooltip=()=>page.locator('[data-slot="tooltip-content"]').filter({hasText:hint});
 await open('技能','组织技能');
 assert.equal(await management().getByRole('heading',{name:'基本信息',exact:true}).count(),0);
 const labels=management().locator('[data-capability-labels]');assert.ok(await labels.getByText('提问方式',{exact:true}).isVisible());assert.ok(await labels.getByText('提示词优化',{exact:true}).isVisible());
 const titleBox=await management().getByRole('heading',{name:'组织技能',exact:true}).boundingBox(),labelsBox=await labels.boundingBox(),descriptionBox=await management().locator('[data-capability-description]').boundingBox(),attributionBox=await management().locator('[data-capability-attribution]').boundingBox();
 assert.ok(titleBox.y<labelsBox.y&&labelsBox.y<descriptionBox.y&&descriptionBox.y<attributionBox.y);
 for(const name of ['开发者','QA','归属部门','系统','业务分类','数据分析'])assert.ok(await management().locator('[data-capability-attribution]').getByText(name,{exact:true}).isVisible());
 for(const name of ['更新','卸载'])assert.ok(await runtime().getByRole('button',{name,exact:true}).isVisible());
 const actionsBox=await runtime().locator('[data-install-runtime-actions]').boundingBox(),stateBox=await runtime().locator('[data-installation-state]').boundingBox();assert.ok(actionsBox.x>stateBox.x+stateBox.width);assert.ok(Math.abs(actionsBox.y-stateBox.y)<16);
 assert.ok(await management().getByRole('button',{name:'查看详情',exact:true}).isVisible());
 assert.equal(await management().locator('p').filter({hasText:hint}).count(),0);assert.equal(await tooltip().count(),0);
 await help().hover();await tooltip().waitFor();assert.equal(await tooltip().textContent(),hint);await page.screenshot({path:'.tmp/installed-layout-tooltip.png',timeout:60000,animations:'disabled'});
 await page.mouse.move(1300,900);await help().blur();await tooltip().waitFor({state:'hidden'});await management().getByRole('button',{name:'查看详情',exact:true}).focus();await page.keyboard.press('Tab');await tooltip().waitFor();await help().blur();await page.mouse.move(1300,900);await tooltip().waitFor({state:'hidden'});
 await management().screenshot({path:'.tmp/installed-layout-desktop.png',timeout:60000,animations:'disabled'});
 await runtime().getByRole('button',{name:'更新',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-install-runtime]')?.textContent.includes('V2'));assert.ok(mutations.some(m=>m.action==='update'&&m.scope==='global'&&m.type==='Skill'));
 await scope('项目');await sidebar.getByRole('button',{name:'组织技能',exact:true}).click();await runtime().getByText('项目',{exact:true}).waitFor();await runtime().getByRole('button',{name:'卸载',exact:true}).click();await sidebar.getByRole('button',{name:'组织技能',exact:true}).waitFor({state:'detached'});assert.ok(mutations.some(m=>m.action==='uninstall'&&m.scope==='project'&&m.type==='Skill'));
 await scope('全局');await sidebar.getByRole('button',{name:'组织技能',exact:true}).waitFor();
 await open('插件','组织插件');await management().getByRole('switch',{name:'启用组织插件',exact:true}).click();await management().getByRole('switch',{name:'禁用组织插件',exact:true}).waitFor();
 await runtime().getByRole('button',{name:'更新',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('更新 · 组织插件',{exact:true}).waitFor();assert.ok(await dialog.getByRole('radio',{name:'全局',exact:true}).isChecked());await dialog.getByRole('button',{name:'确认安装',exact:true}).click();await dialog.waitFor({state:'detached'});assert.ok(mutations.some(m=>m.action==='update'&&m.type==='Plugin'&&m.scope==='global'&&m.preparationToken==='mock-plugin-token'));
 await management().getByRole('button',{name:'查看详情',exact:true}).click();await page.locator('#extension-panel').getByRole('heading',{name:'组织插件',exact:true}).waitFor();await page.locator('#extension-panel').getByRole('button',{name:'关闭',exact:true}).click();
 await open('连接器','组织 MCP');assert.equal(await runtime().getByRole('button',{name:'更新',exact:true}).count(),0);await runtime().getByRole('button',{name:'配置',exact:true}).click();const config=page.getByRole('dialog',{name:'配置 组织 MCP',exact:true});await config.getByRole('spinbutton').fill('25');await config.getByRole('button',{name:'保存配置',exact:true}).click();await config.waitFor({state:'detached'});assert.ok(mutations.some(m=>m.action==='configure'&&m.type==='MCP'&&m.scope==='global'&&m.idleTimeout===25));
 while(await page.getByRole('button',{name:/^关闭通知：/}).count())await page.getByRole('button',{name:/^关闭通知：/}).first().click();
 await page.setViewportSize({width:390,height:844});await runtime().getByRole('button',{name:'卸载',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await management().screenshot({path:'.tmp/installed-layout-mobile-dark.png',timeout:60000,animations:'disabled'});
 await management().getByRole('button',{name:'查看详情',exact:true}).focus();await page.keyboard.press('Tab');await tooltip().waitFor();assert.ok(await tooltip().isVisible());assert.deepEqual(errors,[]);console.log(JSON.stringify({actionsOnRuntimeRight:true,tagsUnderTitle:true,attributionBelowDescription:true,basicInformationRemoved:true,hintOnlyInLibraryTooltip:true,hoverAndKeyboardHelp:true,scopedSkillUpdateAndUninstall:true,pluginUpdateAndToggle:true,connectorConfiguration:true,detailsPreserved:true,mobileAndDark:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/installed-layout-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
