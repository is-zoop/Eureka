import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:8080', cwd='E:/Eureka', otherCwd='E:/Other', now=new Date().toISOString();
const sessions=[cwd,otherCwd].map((cwd,i)=>({id:`nav-qa-${i}`,path:`${cwd}/nav.jsonl`,cwd,projectRoot:cwd,name:`导航验证任务 ${i}`,firstMessage:'保留工作区状态',created:now,modified:now,messageCount:20}));
const messages=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:i%2?[{type:'text',text:`历史回复 ${i}\n\n${'用于检查聊天滚动位置。'.repeat(40)}`}]:`历史问题 ${i}`,timestamp:Date.now()+i,provider:'OpenAI',model:'gpt-5',api:'openai-responses',stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}));
const extension={id:'nav-extension',name:'导航验证技能',type:'Skill',description:'用于导航状态验证',author:'QA',department:null,category:'业务测试',categoryId:1,tags:[],calls:5,isFavorite:false,updatedAt:null,version:'1.0.0',connectType:null,serverUrl:null,versionHistory:[],iconUrl:null};
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
const errors=[],requests=[];let page;
try {
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  await context.addInitScript(()=>{
    localStorage.setItem('pi-sidebar-width','260');
    localStorage.setItem('pi-right-panel-width','500');
    window.__sources=[];
    window.EventSource=class extends EventTarget {
      static OPEN=1; static CLOSED=2; static CONNECTING=0;
      readyState=1; onopen=null; onmessage=null; onerror=null;
      constructor(url){super();this.url=String(url);window.__sources.push(this);setTimeout(()=>{this.onopen?.(new Event('open'));this.dispatchEvent(new Event('open'));this.emit({type:'connected',isStreaming:true});},50);}
      emit(data){if(this.readyState!==1)return;const e=new MessageEvent('message',{data:JSON.stringify(data)});this.onmessage?.(e);this.dispatchEvent(e);}
      close(){this.readyState=2;}
    };
  });
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  let running=true;
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,query:url.search,method:req.method(),command:req.method()==='POST'?req.postDataJSON()?.type:undefined});let data={};
    if(url.pathname==='/api/marketplace-auth/session')data={guest:false,user:{name:'导航测试用户',email:'navigation@example.test',avatarUrl:'/bad-avatar.png'}};
    else if(url.pathname==='/api/sessions')data={sessions,runningSessionIds:running?['nav-qa-0']:[]};
    else if(url.pathname==='/api/agent/running')data={runningSessionIds:running?['nav-qa-0']:[]};
    else if(url.pathname==='/api/home')data={home:'C:/Users/Dominic'};
    else if(url.pathname==='/api/cwd/validate')data={cwd:JSON.parse(req.postData()||'{}').cwd||cwd};
    else if(url.pathname==='/api/worktrees')data={isGit:false,projectRoot:url.searchParams.get('cwd')||cwd,worktrees:[]};
    else if(url.pathname==='/api/models')data={models:{'gpt-5':'GPT-5'},modelList:[{provider:'OpenAI',id:'gpt-5',name:'GPT-5'}],defaultModel:{provider:'OpenAI',modelId:'gpt-5'}};
    else if(url.pathname==='/api/project-trust')data={cwd,trusted:true,requiresTrust:false};
    else if(url.pathname==='/api/organization-extensions')data={items:[extension]};
    else if(url.pathname==='/api/organization-extensions/categories')data={items:[{id:1,name:'业务测试'}]};
    else if(url.pathname.endsWith('/installations'))data={global:[],project:[],items:[]};
    else if(url.pathname.startsWith('/api/organization-extensions/'))data={...extension,item:extension};
    else if(url.pathname.startsWith('/api/files/')){
      const path=decodeURIComponent(url.pathname);
      data=path.endsWith('README.md')?{content:Array.from({length:120},(_,i)=>`文件第 ${i} 行`).join('\n'),language:'text',size:2000}: {entries:path.endsWith('/docs')?[{name:'README.md',isDir:false,size:2000,modified:now}]:[{name:'docs',isDir:true,size:0,modified:now}]};
    }
    else if(url.pathname.startsWith('/api/sessions/')){
      const info=sessions.find(s=>url.pathname===`/api/sessions/${s.id}`);
      if(info)data={sessionId:info.id,filePath:info.path,info,leafId:null,tree:[],context:{messages,entryIds:messages.map((_,i)=>String(i)),model:null},totalActiveMs:0};
      else if(url.pathname.endsWith('/state'))data={running,state:{isStreaming:running,isPromptRunning:running,thinkingLevel:'medium',queuedMessages:[],model:{provider:'OpenAI',id:'gpt-5',name:'GPT-5'}}};
    }
    else if(url.pathname.startsWith('/api/agent/')){
      const state={isStreaming:running,isPromptRunning:running,thinkingLevel:'medium',queuedMessages:[],messages,model:{provider:'OpenAI',id:'gpt-5',name:'GPT-5'}};
      if(req.method()==='POST'){
        const command=JSON.parse(req.postData()||'{}');
        data={success:true,data:command.type==='get_tools'?{tools:[]}:command.type==='get_state'?state:{}};
      } else data={running,state};
    }
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?session=nav-qa-0`,{waitUntil:'domcontentloaded',timeout:60000});
  const home=page.getByRole('button',{name:'主页',exact:true}), ext=page.getByRole('button',{name:'扩展中心',exact:true});
  await home.waitFor({timeout:60000});
  const input=page.locator('[data-app-page="chat"] textarea').first();
  await input.waitFor();await input.fill('尚未发送的草稿，应跨页面保留');
  await page.waitForFunction(()=>window.__sources.some(s=>s.url==='/api/agent/nav-qa-0/events'&&s.readyState===1));
  assert.equal(await ext.count(),1);
  assert.equal(await home.locator('..').evaluate(el=>el.closest('nav').getBoundingClientRect().width),52);
  assert.equal(requests.filter(r=>r.path==='/api/organization-extensions').length,0);
  await page.getByRole('tab',{name:'文件',exact:true}).click();
  await page.locator('#session-sidebar').getByText('docs',{exact:true}).click();
  await page.locator('#session-sidebar').getByText('README.md',{exact:true}).click();
  await page.locator('#file-panel').getByText('文件第 0 行',{exact:false}).first().waitFor();
  const fileContent=page.locator('#file-panel .file-viewer-content');
  assert.equal(await page.locator('#session-sidebar').evaluate(el=>getComputedStyle(el).borderRightWidth),'1px');
  assert.equal(await page.locator('#file-panel').evaluate(el=>getComputedStyle(el).borderLeftWidth),'1px');
  await fileContent.evaluate(el=>{el.scrollTop=420;window.__fileContent=el;});
  const fileScroll=await fileContent.evaluate(el=>el.scrollTop);
  const scroll=page.locator('[data-app-page="chat"] .overflow-y-auto').first();
  await scroll.evaluate(el=>{el.scrollTop=300;});
  const chatScroll=await scroll.evaluate(el=>el.scrollTop);
  const before=await page.evaluate(()=>({sources:window.__sources.filter(s=>s.url==='/api/agent/nav-qa-0/events').length,widths:[localStorage.getItem('pi-sidebar-width'),localStorage.getItem('pi-right-panel-width')]}));
  await input.evaluate(el=>{window.__composer=el;});
  await ext.click();
  await page.locator('[data-app-page="extensions"]').waitFor({state:'visible'});
  assert.equal(await page.locator('#session-sidebar').isVisible(),false);
  assert.equal(await page.locator('#file-panel').isVisible(),false);
  const search=page.locator('[data-app-page="extensions"] input:not([aria-label])').first();
  await search.waitFor();await search.fill('导航验证');
  await page.locator('[data-app-page="extensions"]').getByRole('button',{name:'查看详情',exact:true}).click();
  await page.locator('#extension-panel').waitFor({state:'visible'});
  const abortsBefore=requests.filter(r=>r.command==='abort').length;
  await ext.focus();await page.keyboard.press('Escape');
  assert.equal(requests.filter(r=>r.command==='abort').length,abortsBefore);
  // Deliver a live assistant message while Home is hidden.
  await page.evaluate(()=>{
    const source=window.__sources.findLast(s=>s.url==='/api/agent/nav-qa-0/events'&&s.readyState===1);
    source.emit({type:'agent_start'});
    source.emit({type:'message_start',message:{role:'assistant',content:[{type:'text',text:'后台持续回复验证'}],timestamp:Date.now(),provider:'OpenAI',model:'gpt-5'}});
  });
  await page.screenshot({path:'.tmp/navigation-extensions-desktop.png'});
  await home.click();
  assert.equal(await input.inputValue(),'尚未发送的草稿，应跨页面保留');
  assert.ok(await input.evaluate(el=>el===window.__composer));
  assert.equal(await page.locator('#file-panel').isVisible(),true);
  assert.equal(await fileContent.evaluate(el=>el.scrollTop),fileScroll);
  assert.ok(await fileContent.evaluate(el=>el===window.__fileContent));
  assert.ok(await page.locator('#session-sidebar').getByText('README.md',{exact:true}).isVisible());
  assert.equal(await page.locator('#extension-panel').isVisible(),false);
  assert.equal(await scroll.evaluate(el=>el.scrollTop),chatScroll);
  assert.equal(await page.locator('[data-app-page="chat"]').getByText('后台持续回复验证',{exact:true}).count(),1);
  await ext.click();assert.equal(await search.inputValue(),'导航验证');
  assert.equal(await page.locator('#extension-panel').isVisible(),true);
  const after=await page.evaluate(()=>({sources:window.__sources.filter(s=>s.url==='/api/agent/nav-qa-0/events').length,widths:[localStorage.getItem('pi-sidebar-width'),localStorage.getItem('pi-right-panel-width')]}));
  assert.deepEqual(after,before);
  await home.click();
  const account=page.getByRole('button',{name:'导航测试用户',exact:true});
  await account.click();await page.getByRole('menuitem',{name:'设置',exact:true}).waitFor();
  assert.ok(await page.getByText('navigation@example.test',{exact:true}).isVisible());
  assert.ok(await page.getByRole('menuitem',{name:'退出登录',exact:true}).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({state:'hidden'});
  await page.screenshot({path:'.tmp/navigation-home-desktop.png'});
  // Narrow desktop and dark theme retain the rail without horizontal overflow.
  await page.setViewportSize({width:740,height:860});
  await ext.click();await page.locator('html').evaluate(el=>el.classList.add('dark'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'.tmp/navigation-extensions-narrow-dark.png'});
  await page.locator('#extension-panel').getByRole('button',{name:'关闭',exact:true}).click();
  // Mobile uses the existing drawer, not a persistent rail.
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();
  await home.waitFor({state:'visible'});
  await page.screenshot({path:'.tmp/navigation-mobile-drawer.png'});
  await home.click();
  assert.ok(await page.locator('#session-sidebar').evaluate(el=>el.inert));
  assert.ok(await input.isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#file-panel').getByRole('button',{name:'隐藏文件面板',exact:true}).click();
  await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await ext.click();
  await page.locator('#session-sidebar').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
  assert.ok(await page.locator('#session-sidebar').evaluate(el=>el.inert));
  assert.ok(await search.isVisible());
  assert.equal(await search.inputValue(),'导航验证');
  await page.screenshot({path:'.tmp/navigation-mobile-extensions.png'});
  // Finish the reply while Home stays hidden, then verify the persisted result.
  messages.push({...messages[1],content:[{type:'text',text:'后台持续回复验证'}],timestamp:Date.now()});
  running=false;
  await page.evaluate(()=>{
    const source=window.__sources.findLast(s=>s.url==='/api/agent/nav-qa-0/events'&&s.readyState===1);
    source.emit({type:'agent_end'});source.emit({type:'prompt_done'});source.emit({type:'agent_settled'});
  });
  await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await home.click();
  await page.locator('[data-app-page="chat"]').getByText('后台持续回复验证',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-app-page="chat"]').getByText('后台持续回复验证',{exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'停止 Agent',exact:true}).count(),0);
  // A new project gets a new extension workspace and cannot reuse old details.
  await page.setViewportSize({width:1440,height:900});
  await home.click();
  if(await page.locator('#session-sidebar').evaluate(el=>el.inert))await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();
  await page.getByRole('button',{name:cwd,exact:true}).click();
  await page.getByRole('button').filter({has:page.getByText('Other',{exact:true})}).click();
  await page.getByRole('button',{name:otherCwd,exact:true}).waitFor();
  await ext.click();
  await page.waitForFunction(()=>document.querySelector('[data-app-page="extensions"] input:not([aria-label])')?.value==='');
  assert.equal(await page.locator('#extension-panel').isVisible(),false);
  await page.locator('[data-installed-capabilities]').getByRole('tab',{name:'项目',exact:true}).click();
  assert.ok(await page.locator('[data-app-page="extensions"]').getByText('Other',{exact:true}).isVisible());
  assert.ok(requests.filter(r=>r.path==='/api/organization-extensions').length<=4,'cached pages must not loop requests');
  await page.screenshot({path:'.tmp/navigation-project-reset.png'});
  // Native keyboard activation navigates without starting a fresh session.
  await home.focus();await page.keyboard.press('Enter');
  assert.equal(await home.getAttribute('aria-current'),'page');
  await ext.focus();await page.keyboard.press('Enter');
  assert.equal(await ext.getAttribute('aria-current'),'page');
  await page.reload({waitUntil:'domcontentloaded'});
  await home.waitFor();
  assert.equal(await home.getAttribute('aria-current'),'page');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({railWidth:52,lazyExtensions:true,draftAndComposerPreserved:true,chatScrollPreserved:chatScroll,fileAndFolderPreserved:true,filePositionPreserved:fileScroll,extensionSearchAndDetailsPreserved:true,streamSubscriptionPreserved:before.sources,noDuplicateLiveReply:true,backgroundCompletion:true,projectReset:true,widthsPreserved:after.widths,accountMenuPreserved:true,narrowAndMobile:true,pageErrors:errors}));
}catch(error){if(page){await page.screenshot({path:'.tmp/navigation-qa-failure.png'});console.error(JSON.stringify({sources:await page.evaluate(()=>window.__sources.map(s=>({url:s.url,readyState:s.readyState}))),requests:requests.slice(-30),errors}));}throw error;}
finally{await browser.close();}
