import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:8080',cwd='E:/Eureka';
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
const errors=[];let page;
async function createPage({project=true,guest=false,delayAuth=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  let resolveAuth;const authReady=new Promise(r=>{resolveAuth=r;});if(!delayAuth)resolveAuth();
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let data={};
    if(url.pathname==='/api/marketplace-auth/session'){await authReady;data={guest,user:{name:guest?'stale profile':'头像失败测试',email:'avatar@example.test',avatarUrl:'/avatar-that-fails.png'}};}
    else if(url.pathname==='/api/sessions')data={sessions:[],runningSessionIds:[]};
    else if(url.pathname==='/api/agent/running')data={runningSessionIds:[]};
    else if(url.pathname==='/api/cwd/validate')data={cwd};
    else if(url.pathname==='/api/models')data={models:{},modelList:[],defaultModel:null};
    else if(url.pathname==='/api/worktrees')data={isGit:false,projectRoot:cwd,worktrees:[]};
    else if(url.pathname.startsWith('/api/files/'))data={entries:[]};
    else if(url.pathname==='/api/organization-extensions')data={items:[]};
    else if(url.pathname==='/api/organization-extensions/categories')data={items:[]};
    else if(url.pathname==='/api/skills')data={skills:[]};
    else if(url.pathname==='/api/models-config')data={providers:{}};
    else if(url.pathname==='/api/auth/providers'||url.pathname==='/api/auth/all-providers')data={providers:[]};
    await route.fulfill({json:data});
  });
  await page.route('**/avatar-that-fails.png',route=>route.fulfill({status:404,body:''}));
  await page.goto(project?`${base}/?cwd=${encodeURIComponent(cwd)}`:base,{waitUntil:'domcontentloaded'});
  return {page,context,resolveAuth};
}
try{
  const setup=await createPage({delayAuth:true});page=setup.page;
  const loading=page.locator('button[aria-busy="true"]');await loading.waitFor();
  assert.ok(await loading.isDisabled());assert.equal(await loading.locator('[data-slot="skeleton"]').count(),1);
  setup.resolveAuth();
  const account=page.getByRole('button',{name:'头像失败测试',exact:true});await account.waitFor();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="头像失败测试"] img')===null);
  assert.equal(await account.innerText(),'');assert.equal(await account.locator('svg').count(),1);
  await account.hover();await page.locator('[data-slot="tooltip-content"]').filter({hasText:'头像失败测试'}).waitFor();
  await account.click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'返回应用',exact:false}).click();
  const input=page.locator('[data-app-page="chat"] textarea').first();await input.fill('新任务草稿保留');
  await input.evaluate(el=>{window.__freshComposer=el;});
  const home=page.getByRole('button',{name:'主页',exact:true}),ext=page.getByRole('button',{name:'扩展中心',exact:true});
  const separator=page.locator('[data-resize-handle="sidebar"]');
  await separator.focus();await page.keyboard.press('ArrowRight');
  const bounds=await separator.boundingBox();
  await page.mouse.move(bounds.x+6,bounds.y+100);await page.mouse.down();await page.mouse.move(bounds.x+36,bounds.y+100);await page.mouse.up();
  const resized=await page.evaluate(()=>localStorage.getItem('pi-sidebar-width'));
  assert.equal(resized,'302');
  await page.getByRole('button',{name:'隐藏侧边栏',exact:true}).click();
  assert.ok(await page.locator('#session-sidebar').evaluate(el=>el.inert));
  await ext.click();await home.click();
  assert.ok(await page.locator('#session-sidebar').evaluate(el=>el.inert),'Home restores the collapsed sidebar');
  assert.equal(await input.inputValue(),'新任务草稿保留');assert.ok(await input.evaluate(el=>el===window.__freshComposer));
  assert.equal(await page.evaluate(()=>localStorage.getItem('pi-sidebar-width')),resized);
  await setup.context.close();
  const guestSetup=await createPage({guest:true});page=guestSetup.page;
  const guestButton=page.getByRole('button',{name:'不愿意透露姓名的神秘用户',exact:true});await guestButton.waitFor();
  assert.equal(await guestButton.locator('img').getAttribute('src'),'/icons/guest-avatar.png');
  await guestButton.click();await page.getByRole('menuitem',{name:'账号登录',exact:true}).waitFor();
  assert.equal(await page.getByText('stale profile',{exact:true}).count(),0);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'扩展中心',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'组织扩展',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('tab',{name:'市场扩展',exact:true}).getAttribute('aria-selected'),'true');
  await guestSetup.context.close();
  const empty=await createPage({project:false,guest:true});page=empty.page;
  const disabledExt=page.getByRole('button',{name:'扩展中心',exact:true});await disabledExt.waitFor();
  assert.equal(await disabledExt.getAttribute('aria-disabled'),'true');
  await disabledExt.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-app-page="extensions"]').count(),0);
  await disabledExt.hover();await page.locator('[data-slot="tooltip-content"]').filter({hasText:'从侧边栏选择项目目录'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({accountLoading:true,avatarFailureFallback:true,accountTooltip:true,settingsAction:true,freshDraftPreserved:true,collapsedSidebarPreserved:true,guestAvatarAndLoginMenu:true,guestMarketRulePreserved:true,noProjectDisabledWithHint:true,pageErrors:errors}));
}catch(e){if(page){await page.screenshot({path:'.tmp/navigation-edge-failure.png'});console.error((await page.locator('body').innerText()).slice(0,2200));}throw e;}
finally{await browser.close();}
