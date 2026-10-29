import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base='http://127.0.0.1:8080';
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    let data={};
    if(url.pathname==='/api/models')data={models:{'gpt-5':'GPT-5'},modelList:[{provider:'OpenAI',id:'gpt-5',name:'GPT-5'}],defaultModel:{provider:'OpenAI',modelId:'gpt-5'}};
    if(url.pathname==='/api/sessions')data={sessions:[],runningSessionIds:[]};
    if(url.pathname==='/api/cwd/validate')data={cwd:'E:/Eureka'};
    if(url.pathname==='/api/agent/running')data={runningSessionIds:[]};
    if(url.pathname==='/api/worktrees')data={isGit:false,projectRoot:'E:/Eureka',worktrees:[]};
    if(url.pathname.startsWith('/api/files/'))data={entries:[]};
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?cwd=E%3A%2FEureka`,{waitUntil:'domcontentloaded'});
  const model=page.getByRole('button',{name:'Change model: GPT-5',exact:true});
  const effort=page.getByRole('button',{name:'更改推理级别',exact:true});
  await model.waitFor();
  for(const [name,trigger] of [['model',model],['reasoning',effort]]){
    await trigger.hover();
    const tip=page.locator('[data-slot=tooltip-content]');
    try {await tip.waitFor({timeout:5000});}catch(error){console.log(JSON.stringify({name,trigger:await trigger.evaluate(el=>el.outerHTML),tooltips:await page.locator('[data-slot=tooltip-content]').evaluateAll(els=>els.map(el=>el.outerHTML)),errors}));await page.screenshot({path:'.tmp/composer-tooltip-debug.png'});throw error;}
    const style=await tip.evaluate(el=>{const css=getComputedStyle(el);return {background:css.backgroundColor,color:css.color,border:css.borderWidth};});
    assert.deepEqual(style,{background:'rgb(48, 48, 46)',color:'rgb(255, 255, 255)',border:'0px'});
    assert.equal(await tip.locator('[data-slot=tooltip-arrow]').count(),1);
    assert.equal(await trigger.getAttribute('title'),null);
    const before=await tip.boundingBox();
    const button=await trigger.boundingBox();
    await page.mouse.move(button.x+button.width-5,button.y+button.height/2);
    const after=await tip.boundingBox();
    assert.ok(Math.abs(before.x-after.x)<2);
    await page.screenshot({path:`.tmp/composer-${name}-tooltip.png`});
    await trigger.click();
    await tip.waitFor({state:'hidden'});
    await page.keyboard.press('Escape');
    await page.mouse.move(900,100);
  }
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await effort.hover();
  await page.locator('[data-slot=tooltip-content]').waitFor();
  const dark=await page.locator('[data-slot=tooltip-content]').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));
  assert.deepEqual(dark,{bg:'rgb(232, 232, 232)',text:'rgb(36, 36, 36)'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tooltips:2,libraryStyle:true,arrow:true,anchored:true,hiddenWhileMenuOpen:true,darkTheme:true,pageErrors:errors}));
}finally{await browser.close();}
