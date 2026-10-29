import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:8080', cwd='E:/Eureka', now=new Date().toISOString();
const userTitle='帮我查下昨日的天猫销售数据';
const raw=`${userTitle}\n\n<eureka-selected-plugins>${JSON.stringify({plugins:[{source:'https://example.test',capabilityId:'66',digest:'a'.repeat(64),name:'销售助手'}],context:'Private plugin instructions'})}</eureka-selected-plugins>`;
const skillTitle='查询昨日销量';
const sessions=[
  {id:'title-plugin-qa',firstMessage:raw,name:raw.replace(/\n/g,' ')},
  {id:'title-skill-qa',firstMessage:`<skill name="atlas-ask" location="/skills/atlas/SKILL.md">\nReferences are relative to /skills/atlas.\n\nPrivate instructions.\n</skill>\n\n${skillTitle}`},
].map(s=>({...s,path:`${cwd}/${s.id}.jsonl`,cwd,projectRoot:cwd,created:now,modified:now,messageCount:1}));
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let data={};
    if(url.pathname==='/api/sessions')data={sessions,runningSessionIds:[]};
    else if(url.pathname==='/api/agent/running')data={runningSessionIds:[]};
    else if(url.pathname.startsWith('/api/agent/')){await route.fulfill({status:404,json:{error:'Not running'}});return;}
    else if(url.pathname==='/api/worktrees')data={projectRoot:cwd,isGit:false,worktrees:[]};
    else if(url.pathname==='/api/models')data={models:{},modelList:[],defaultModel:null};
    else if(url.pathname.startsWith('/api/files/'))data={entries:[]};
    else if(url.pathname.startsWith('/api/sessions/')){
      const info=sessions.find(s=>url.pathname===`/api/sessions/${s.id}`);
      if(info)data={sessionId:info.id,filePath:info.path,info,leafId:null,tree:[],context:{messages:[],entryIds:[],model:null},totalActiveMs:0};
    }
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?session=title-plugin-qa`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(title=>Array.from(document.querySelectorAll('span')).filter(el=>el.textContent===title).length>=2,userTitle);
  let visible=await page.locator('body').innerText();
  assert.ok(!visible.includes('eureka-selected-plugins'));
  assert.ok(!visible.includes('capabilityId'));
  await page.screenshot({path:'.tmp/session-title-clean-plugin.png'});
  await page.locator('#session-sidebar').getByText(skillTitle,{exact:true}).click();
  await page.waitForFunction(title=>Array.from(document.querySelectorAll('span')).filter(el=>el.textContent===title).length>=2,skillTitle);
  visible=await page.locator('body').innerText();
  assert.ok(!visible.includes('/skill:atlas-ask'));
  assert.ok(!visible.includes('<skill'));
  assert.ok(!visible.includes('Private instructions'));
  await page.getByRole('button',{name:'搜索任务',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('capabilityId');
  await page.getByText('未找到匹配任务',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({topAndSidebarClean:true,existingPollutedNameClean:true,skillArgsOnly:true,metadataNotSearchable:true,pageErrors:errors}));
}finally{await browser.close();}
