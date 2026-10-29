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
let failReadme=false,emptyReadme=false,delayReadme=false;const contentRequests=[];
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
  else if(url.pathname.endsWith('/content')){
   const id=url.pathname.split('/')[3],file=url.searchParams.get('file');contentRequests.push({id,file});
   if(failReadme&&file==='README.md'){failReadme=false;await route.fulfill({status:500,json:{error:'fixture content failure'}});return;}
   data={basePath:'docs',content:emptyReadme&&file==='README.md'?null:file==='README.md'?`# 能力${id} 文档说明\n\n配置和使用方法。\n\n代码示例\n{"enabled":true}\n`:`# 能力${id} 快速开始\n\n先安装，再开始使用。\n\n![示例](images/demo.svg)\n\n- 准备项目\n- 发起任务`};
   if(data.content)data.content+='\n\n'+Array.from({length:35},(_,i)=>`使用步骤 ${i+1}：阅读说明并完成配置。`).join('\n\n');
   data.content=data.content?.replaceAll('\\n','\n');
   if(delayReadme&&file==='README.md')await new Promise(r=>setTimeout(r,600));
  }
  else if(url.pathname.includes('/documentation/')){await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24"><rect width="80" height="24" fill="lightblue"/></svg>'});return;}
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
 managed.push({...managed.find(i=>i.capabilityId==='4'),scope:'global'});
 for(const item of catalog){item.tags=['提问方式','提示词优化'];item.department='系统';item.category='数据分析';if(item.type!=='Plugin')item.versionHistory=[{version:'1.0.0',createdAt:'2026-09-01',changelog:'- 首次发布\n- 完善示例'},{version:'v1.1.0',createdAt:'2026-10-20',changelog:['优化能力说明','修复配置问题',...Array.from({length:25},(_,i)=>`版本变更 ${i+1}`)]}];}
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();



 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 const panel=()=>workspace.getByRole('region').filter({visible:true}),management=()=>panel().locator('[data-installed-management]'),resources=()=>management().locator('[data-installed-resources]');
 await sidebar.getByRole('navigation').getByRole('button',{name:'技能',exact:true}).click();await sidebar.getByRole('button',{name:'组织技能',exact:true}).click();await resources().getByRole('heading',{name:'能力1 快速开始',exact:true}).waitFor();
 const results=[];
 for(const height of [960,786,680,1100]){
  await page.setViewportSize({width:1440,height});await page.waitForTimeout(150);
  const metrics=await management().evaluate(el=>{const parent=el.parentElement,boxes=[...el.querySelectorAll('[data-resource-panel]')].map(b=>({top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom,height:b.getBoundingClientRect().height}));return {parentBottom:parent.getBoundingClientRect().bottom,gap:parent.getBoundingClientRect().bottom-boxes[0].bottom,boxes,outerScroll:parent.scrollHeight-parent.clientHeight};});
  results.push({height,...metrics});assert.equal(metrics.gap,22.5,JSON.stringify(metrics));assert.equal(metrics.boxes[0].height,metrics.boxes[1].height);const topGap=await resources().evaluate(el=>parseFloat(getComputedStyle(el).marginTop));assert.equal(metrics.gap,topGap);
 }
 const tabs=resources().getByRole('tab'),docBody=resources().getByRole('tabpanel'),historyBody=resources().locator('[data-version-history-scroll]');
 for(const tab of await tabs.all())assert.equal(await tab.evaluate(el=>el.getBoundingClientRect().height),28);
 for(const body of [docBody,historyBody])assert.equal(await body.evaluate(el=>getComputedStyle(el).overflowY),'auto');
 await docBody.evaluate(el=>{el.scrollTop=150;});assert.ok(await docBody.evaluate(el=>el.scrollTop>0));assert.equal(await historyBody.evaluate(el=>el.scrollTop),0);await docBody.evaluate(el=>{el.scrollTop=0;});
 await page.setViewportSize({width:1440,height:786});await page.screenshot({path:'.tmp/resources-fill-bottom.png',timeout:60000,animations:'disabled'});
 await resources().getByRole('tab',{name:'查看文档',exact:true}).click();await resources().getByRole('heading',{name:'能力1 文档说明',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});const history=resources().locator('[data-capability-version-history]');await history.scrollIntoViewIfNeeded();assert.ok(await history.getByRole('heading').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const mobileGap=await management().evaluate(el=>{const parent=el.parentElement;parent.scrollTop=parent.scrollHeight;return parent.getBoundingClientRect().bottom-el.querySelector('[data-resource-panel="history"]').getBoundingClientRect().bottom;});assert.ok(Math.abs(mobileGap-22.5)<=1,JSON.stringify({mobileGap}));
 assert.deepEqual(errors,[]);assert.equal(mutations.length,0);console.log(JSON.stringify({responsiveHeights:results,mobileBottomGap:mobileGap,topAndBottomGapEqual:true,tabs28px:true,independentScrolling:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/resources-fill-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
