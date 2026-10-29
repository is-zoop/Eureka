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
managed[2].plugin={state:'loaded',skills:['组件技能'],servers:[{name:'组件服务',url:'https://connector.test'}]};
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
    if(body.action==='prepare'){await route.fulfill({json:{preparationToken:'mock-plugin-token',expiresAt:Date.now()+60000,name:'组织插件',version:'2',skills:['组件技能'],servers:[{name:'组件服务',url:'https://connector.test'}],requiresApproval:false}});return;}
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
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true}),flat=()=>panel().locator('[data-installed-management]');
 const category=async(name)=>sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).click();
 const checkType=async(type)=>{assert.ok(await flat().getByText(type,{exact:true}).count()>0);for(const raw of ['Skill','Plugin','MCP'])assert.equal(await flat().getByText(raw,{exact:true}).count(),0);};
 for(const name of ['技能','连接器','插件'])assert.ok(await sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).isVisible());
 await panel().locator('.organization-extension-card').first().waitFor();assert.ok(await panel().locator('.organization-extension-card').first().getByText('技能',{exact:true}).isVisible());
 await sidebar.getByRole('button',{name:'组织技能',exact:true}).click();await flat().waitFor();await checkType('技能');
 await category('插件');await panel().locator('.organization-extension-card').first().waitFor();assert.ok(await panel().locator('.organization-extension-card').first().getByText('插件',{exact:true}).isVisible());
 await sidebar.getByRole('button',{name:'组织插件',exact:true}).click();await flat().waitFor();await checkType('插件');
 await flat().getByRole('button',{name:'查看详情',exact:true}).click();const details=page.locator('#extension-panel');await details.getByText('技能 · 组件技能',{exact:true}).waitFor();await details.getByText('连接器 · 组件服务 · https://connector.test',{exact:true}).waitFor();assert.ok(await details.getByText('插件',{exact:true}).isVisible());await details.getByRole('button',{name:'关闭',exact:true}).click();
 await flat().getByRole('button',{name:'更新',exact:true}).click();const pluginDialog=page.getByRole('dialog');await pluginDialog.getByText('技能 · 组件技能',{exact:true}).waitFor();await pluginDialog.getByText('连接器 · 组件服务',{exact:true}).waitFor();await pluginDialog.getByRole('button',{name:'取消',exact:true}).click();
 await category('连接器');await panel().locator('.organization-extension-card').first().waitFor();assert.ok(await panel().locator('.organization-extension-card').first().getByText('连接器',{exact:true}).isVisible());
 await sidebar.getByRole('button',{name:'组织 MCP',exact:true}).click();await flat().waitFor();await checkType('连接器');
 await flat().getByRole('button',{name:'查看详情',exact:true}).click();await details.getByText('连接器',{exact:true}).waitFor();assert.equal(await details.getByText('MCP',{exact:true}).count(),0);await details.getByRole('button',{name:'关闭',exact:true}).click();
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();await category('连接器');await panel().getByRole('heading',{name:'添加连接器',exact:true}).waitFor();assert.equal(await panel().getByText('MCP',{exact:true}).count(),0);
 await page.screenshot({path:'.tmp/extension-connector-chinese.png'});
 await page.evaluate(()=>localStorage.setItem('pi-locale','en'));await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Extension Center',exact:true}).click();
 await panel().locator('.organization-extension-card').first().waitFor();assert.ok(await panel().locator('.organization-extension-card').first().getByText('Skills',{exact:true}).isVisible());
 for(const name of ['Skills','MCP','Plugins'])assert.ok(await sidebar.getByRole('navigation').getByRole('button',{name,exact:true}).isVisible());
 assert.equal(await sidebar.getByRole('navigation').getByRole('button',{name:'连接器',exact:true}).count(),0);
 await category('MCP');await sidebar.getByRole('button',{name:'组织 MCP',exact:true}).click();await flat().waitFor();assert.ok(await flat().getByText('MCP',{exact:true}).count()>0);
 await sidebar.getByRole('button',{name:'Extension source',exact:true}).click();await page.getByRole('menuitem',{name:'Marketplace extensions',exact:true}).click();await category('MCP');await panel().getByRole('heading',{name:'Add MCP server',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({chineseNavigationNames:true,cardAndManagementTypeLabels:true,detailTypeLabels:true,pluginComponentNames:true,installDialogComponentNames:true,connectorConfigNames:true,englishMcpPreserved:true,originalCapabilityNamesPreserved:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/installed-sidebar-failure.png'});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
