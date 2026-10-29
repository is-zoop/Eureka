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
 await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'扩展中心',exact:true}).click();



 let metadataFail=true,metadataRetries=0;
 await page.route('**/api/plugins?**',async route=>{if(route.request().method()==='GET'){metadataRetries++;if(metadataFail){await route.fulfill({status:500,json:{error:'fixture load failed'}});return;}}await route.fallback();});
 const workspace=page.locator('[data-app-page="extensions"]'),sidebar=workspace.locator('[data-installed-capabilities]');
 await sidebar.getByRole('button',{name:'扩展来源',exact:true}).click();await page.getByRole('menuitem',{name:'市场扩展',exact:true}).click();
 await sidebar.getByRole('navigation').getByRole('button',{name:'插件',exact:true}).click();
 const active=()=>workspace.getByRole('region').filter({visible:true});const form=()=>active().locator('[data-plugin-source-install]');
 await form().getByRole('heading',{name:'从来源安装',exact:true}).waitFor();
 const loadNotice=page.locator('.notification-card').filter({hasText:'fixture load failed'});await loadNotice.getByRole('button',{name:'重试',exact:true}).waitFor();metadataFail=false;const requestsBefore=metadataRetries;const retryResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/plugins'&&response.status()===200);await loadNotice.getByRole('button',{name:'重试',exact:true}).click();await retryResponse;assert.ok(metadataRetries>requestsBefore);while(await loadNotice.count())await loadNotice.first().getByRole('button',{name:/关闭通知/}).click();
 const directory=workspace.getByRole('link',{name:'浏览插件目录',exact:true});assert.equal(await directory.getAttribute('href'),'https://pi.dev/packages');assert.equal(await directory.evaluate(el=>el.getBoundingClientRect().height),28);assert.equal(await directory.locator('[data-plugin-directory-icon] path').count(),2);assert.match(await directory.locator('path').first().getAttribute('d'),/^M165.29 165.29/);
 assert.equal(await active().getByRole('button',{name:'刷新',exact:true}).count(),0);assert.equal(await active().getByText('插件',{exact:true}).count(),0);assert.equal(await active().getByRole('button',{name:'global',exact:true}).count(),0);
 for(const [scopeLabel,scope,prompt] of [['全局','global','安装到全局'],['项目','project','安装到当前项目']]){
  await sidebar.getByRole('tab',{name:scopeLabel,exact:true}).click();await form().getByText(prompt,{exact:true}).waitFor();
  const input=form().getByRole('textbox',{name:'插件来源',exact:true}),install=form().getByRole('button',{name:'安装',exact:true});
  await input.fill('');assert.ok(await install.isDisabled());
  for(const example of ['npm 包','Git 仓库','本地目录']){const button=form().getByRole('button').filter({has:page.getByText(example,{exact:true})});await button.click();assert.ok((await input.inputValue()).length>0);assert.equal(await input.evaluate(el=>document.activeElement===el),true);}
  await input.fill('pi install npm:qa-'+scope);await input.press('Tab');assert.equal(await input.inputValue(),'npm:qa-'+scope);
  assert.equal(await install.evaluate(el=>el.getBoundingClientRect().height),36);
  await input.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-plugin-source-install] input')?.value==='');assert.ok(mutations.some(m=>m.action==='install'&&m.source==='npm:qa-'+scope&&m.scope===scope));
  await form().getByRole('button',{name:'安装位置',exact:true}).hover();const tooltip=page.locator('[data-slot="tooltip-content"]');await tooltip.waitFor();assert.match(await tooltip.innerText(),scope==='global'?/~\/.pi\/agent/:/E:\/Eureka\/.pi\/agent/);await page.mouse.move(0,0);
 }
 await page.screenshot({path:'.tmp/market-plugin-compact-desktop.png',timeout:60000,animations:'disabled'});
 // Existing installed package management is still reachable and does not show the market directory action.
 const installed=sidebar.getByRole('button').filter({has:page.getByText('市场插件',{exact:true})});await installed.first().click();await active().getByRole('button',{name:'移除',exact:true}).waitFor();assert.equal(await directory.count(),0);
 await sidebar.getByRole('navigation').getByRole('button',{name:'插件',exact:true}).click();await form().waitFor();
 // Normalized pasted commands retain the original install-input behavior.
 const input=form().getByRole('textbox',{name:'插件来源',exact:true});await input.evaluate(el=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>'$ pi install npm:from-paste'}});el.dispatchEvent(event);});assert.equal(await input.inputValue(),'npm:from-paste');
 await page.route('**/api/plugins',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().source==='npm:fail'){await route.fulfill({status:500,json:{error:'fixture install failed'}});}else await route.fallback();});
 await input.fill('npm:fail');await form().getByRole('button',{name:'安装',exact:true}).click();await page.getByText('fixture install failed',{exact:true}).waitFor();assert.equal(await input.inputValue(),'npm:fail');
 const layouts=[];
 for(const width of [1440,1000,800,390,320]){await page.setViewportSize({width,height:960});await form().waitFor();await form().getByRole('textbox',{name:'插件来源',exact:true}).focus();const result=await form().evaluate(el=>{const r=el.getBoundingClientRect(),input=el.querySelector('input').getBoundingClientRect(),install=el.querySelector('button').getBoundingClientRect();const boundary=el.closest('[data-notification-boundary]').getBoundingClientRect(),field=el.querySelector('input'),style=getComputedStyle(field),accent=document.createElement('span');accent.style.color='var(--accent)';el.append(accent);const accentColor=getComputedStyle(accent).color;accent.remove();return {leftGap:r.left-boundary.left,rightGap:boundary.right-r.right,focusBorder:style.borderColor,focusShadow:style.boxShadow,accentColor,right:r.right,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth,inputHeight:input.height,buttonHeight:install.height,sameRow:Math.abs(input.y-install.y)<1};});assert.ok(!result.overflow&&result.right<=width);assert.equal(result.leftGap,24);assert.equal(result.rightGap,24);assert.notEqual(result.focusBorder,result.accentColor);assert.notEqual(result.focusShadow,'none');assert.equal(result.inputHeight,36);assert.equal(result.buttonHeight,36);if(width===1440)assert.ok(result.sameRow);if(width===390)assert.equal(result.sameRow,false);layouts.push({width,...result});}
 await page.setViewportSize({width:390,height:960});await page.screenshot({path:'.tmp/market-plugin-compact-mobile.png',timeout:60000,animations:'disabled'});
 await page.setViewportSize({width:1440,height:960});await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:'.tmp/market-plugin-compact-dark.png',timeout:60000,animations:'disabled'});
 await form().getByRole('textbox',{name:'插件来源',exact:true}).focus();const darkFocus=await form().getByRole('textbox',{name:'插件来源',exact:true}).evaluate(el=>({border:getComputedStyle(el).borderColor,shadow:getComputedStyle(el).boxShadow}));assert.notEqual(darkFocus.shadow,'none');const iconFill=await directory.locator('path').first().evaluate(el=>getComputedStyle(el).fill);assert.notEqual(iconFill,'rgb(0, 0, 0)');
 await page.evaluate(()=>localStorage.setItem('pi-locale','en'));await page.reload();await page.getByRole('button',{name:'Extension Center',exact:true}).click();const englishSidebar=page.locator('[data-app-page="extensions"] [data-installed-capabilities]');await englishSidebar.getByRole('button',{name:'Extension source',exact:true}).click();await page.getByRole('menuitem',{name:'Marketplace extensions',exact:true}).click();await englishSidebar.getByRole('navigation').getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('heading',{name:'Install from source',exact:true}).waitFor();await page.getByRole('link',{name:'Browse plugin directory',exact:true}).waitFor();await page.setViewportSize({width:320,height:960});assert.equal(await page.locator('[data-notification-boundary="30"]').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 console.log(JSON.stringify({compactInstall:true,originalDirectoryIcon:true,scopeFromNavigation:true,sourceExamplesAndKeyboard:true,commandPaste:true,errorPreservesInput:true,layouts,darkIconFill:iconFill,pageErrors:errors}));assert.deepEqual(errors,[]);
}catch(e){if(page){await page.screenshot({path:'.tmp/market-plugin-compact-failure.png',timeout:5000}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-4000));}throw e;}
finally{await browser.close();}
