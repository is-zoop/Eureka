import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:8080',cwd='E:/Eureka';
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let data={};
    if(url.pathname==='/api/marketplace-auth/session')data={guest:true,user:{name:'Guest'}};
    else if(url.pathname==='/api/sessions')data={sessions:[],runningSessionIds:[]};
    else if(url.pathname==='/api/agent/running')data={runningSessionIds:[]};
    else if(url.pathname==='/api/cwd/validate')data={cwd};
    else if(url.pathname==='/api/models')data={models:{},modelList:[],defaultModel:null};
    else if(url.pathname==='/api/worktrees')data={isGit:false,projectRoot:cwd,worktrees:[]};
    else if(url.pathname.startsWith('/api/files/'))data={entries:[]};
    else if(url.pathname==='/api/skills')data={skills:[]};
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
  const home=page.getByRole('button',{name:'主页',exact:true}),ext=page.getByRole('button',{name:'扩展中心',exact:true});await home.waitFor();
  const getStyle=()=>page.evaluate(()=>{
    const side=document.querySelector('#session-sidebar'),main=document.querySelector('.eureka-main-column'),nav=document.querySelector('[data-app-navigation]');
    return {sidebarBg:getComputedStyle(side).backgroundColor,innerBg:getComputedStyle(side.firstElementChild).backgroundColor,railBg:getComputedStyle(nav).backgroundColor,sidebarRadius:getComputedStyle(side).borderTopLeftRadius,mainRadius:getComputedStyle(main).borderTopLeftRadius,mainBorder:getComputedStyle(main).borderLeftWidth,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  let style=await getStyle();assert.equal(style.sidebarBg,'rgb(252, 252, 252)');assert.equal(style.innerBg,style.sidebarBg);assert.equal(style.railBg,'rgb(246, 246, 246)');assert.equal(style.sidebarRadius,'14px');assert.equal(style.mainRadius,'0px');assert.equal(style.mainBorder,'0px');assert.equal(style.overflow,false);
  await page.locator('html').evaluate(el=>el.classList.add('eureka-desktop','eureka-native-titlebar'));
  assert.equal((await getStyle()).mainRadius,'0px');
  await page.screenshot({path:'.tmp/sidebar-surface-light.png'});
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));style=await getStyle();assert.equal(style.sidebarBg,'rgb(32, 32, 32)');assert.equal(style.railBg,'rgb(36, 36, 36)');
  await page.screenshot({path:'.tmp/sidebar-surface-dark.png',animations:'disabled'});
  await ext.click();assert.equal((await getStyle()).mainRadius,'14px');await home.click();assert.equal((await getStyle()).mainRadius,'0px');
  await page.getByRole('button',{name:'隐藏侧边栏',exact:true}).click();assert.equal((await getStyle()).mainRadius,'14px');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();
  style=await getStyle();assert.equal(style.sidebarRadius,'0px');assert.equal(style.mainRadius,'0px');assert.equal(style.overflow,false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({lightAndDarkSurface:true,sidebarOwnsExpandedCorner:true,collapsedAndExtensionsOwnCorner:true,mobileDrawerUnchanged:true,pageErrors:errors}));
}finally{await browser.close();}
