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
        const command=JSON.parse(req.postData()||'{}');if(command.type==='reload')await new Promise(resolve=>setTimeout(resolve,700));
        data={success:true,data:command.type==='get_tools'?{tools:[]}:command.type==='get_state'?state:{}};
      } else data={running,state};
    }
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?session=nav-qa-0`,{waitUntil:'domcontentloaded',timeout:60000});
 const home=page.getByRole('button',{name:'主页',exact:true}),ext=page.getByRole('button',{name:'扩展中心',exact:true});
 await home.waitFor();const draft=page.locator('[data-app-page="chat"] textarea').first();await draft.fill('reload layout draft');await ext.click();
 const workspace=page.locator('[data-app-page="extensions"]'),reload=workspace.getByRole('button',{name:'重新加载',exact:true});
 await reload.waitFor();await workspace.getByRole('heading',{name:'导航验证技能',exact:true}).waitFor();
 assert.equal(await reload.evaluate(el=>el.parentElement.tagName==='HEADER'&&!!el.parentElement.querySelector('h1')),true);
 assert.equal(await reload.locator('svg[aria-hidden="true"]').count(),1);assert.equal(await workspace.getByRole('region').filter({visible:true}).getByRole('button',{name:'重新加载',exact:true}).count(),0);
 await reload.click();await page.getByText('请等待当前运行完成后再重载。',{exact:true}).waitFor();
 assert.equal(requests.filter(r=>r.command==='reload').length,0);
 running=false;await reload.click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='重新加载'&&el.disabled));
 assert.equal(await reload.getAttribute('aria-busy'),'true');assert.ok(await reload.locator('svg').evaluate(el=>el.classList.contains('animate-spin')));
 await workspace.locator('[data-installed-capabilities]').getByRole('navigation').getByRole('button',{name:'MCP',exact:true}).click();assert.ok(await reload.isDisabled());
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='重新加载'&&!el.disabled));
 assert.equal(requests.filter(r=>r.command==='reload').length,1);assert.equal(requests.find(r=>r.command==='reload').path,'/api/agent/nav-qa-0');
 await page.screenshot({path:'.tmp/extension-reload-header-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.ok(await reload.isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'.tmp/extension-reload-header-mobile.png'});
 await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();await home.click();assert.equal(await draft.inputValue(),'reload layout draft');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({reloadMovedToTitleHeader:true,refreshIcon:true,oldToolbarButtonRemoved:true,streamingGuardPreserved:true,busyStateAndSpinner:true,sameReloadCommand:true,mobileNoOverflow:true,homeDraftPreserved:true,pageErrors:errors}));
}catch(error){if(page){await page.screenshot({path:'.tmp/navigation-qa-failure.png'});console.error(JSON.stringify({sources:await page.evaluate(()=>window.__sources.map(s=>({url:s.url,readyState:s.readyState}))),requests:requests.slice(-30),errors}));}throw error;}
finally{await browser.close();}
