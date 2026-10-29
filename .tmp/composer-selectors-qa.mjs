import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8080';
const cwd = 'E:\\Eureka';
const modelList = [
  {id:'gpt-5',name:'GPT-5',provider:'OpenAI'},
  {id:'gpt-5-mini',name:'GPT-5 mini',provider:'OpenAI'},
  {id:'claude-sonnet-4-6',name:'Claude Sonnet 4.6',provider:'Anthropic'},
  ...Array.from({length:18},(_,i)=>({id:`model-${i}`,name:`Model ${i}`,provider:'Local'})),
];
const browser = await chromium.launch({headless:true,executablePath:chromium.executablePath()});
try {
  const context = await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const url = new URL(route.request().url());
    let data = {};
    switch(url.pathname){
      case '/api/sessions': data={sessions:[],runningSessionIds:[]};break;
      case '/api/home':data={home:'C:\\Users\\Dominic'};break;
      case '/api/cwd/validate':data={cwd};break;
      case '/api/agent/running':data={runningSessionIds:[]};break;
      case '/api/worktrees':data={projectRoot:cwd,isGit:false,worktrees:[]};break;
      case '/api/git/status':data={files:[]};break;
      case '/api/models':data={models:Object.fromEntries(modelList.map(m=>[m.id,m.name])),modelList,defaultModel:{provider:'OpenAI',modelId:'gpt-5'},thinkingLevels:Object.fromEntries(modelList.map(m=>[`${m.provider}:${m.id}`,['low','medium','high']]))};break;
      default:if(url.pathname.startsWith('/api/files/'))data={entries:[]};
    }
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
  const trigger = page.getByRole('button',{name:'Change model: GPT-5',exact:true});
  await trigger.waitFor();
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderRadius),'9px');
  await trigger.click();
  const popup = page.getByRole('dialog',{name:'筛选模型…',exact:true});
  await popup.waitFor();
  const search = popup.getByRole('combobox');
  assert.ok(await search.evaluate(el=>document.activeElement===el));
  assert.equal(await popup.evaluate(el=>getComputedStyle(el).borderRadius),'12px');
  assert.equal(await popup.locator('[data-current=true] svg').count(),0);
  assert.equal(await popup.locator('[data-current=true]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(48, 48, 46)');
  assert.equal(await popup.locator('[cmdk-group-heading]').count(),3);
  assert.ok(await popup.locator('[cmdk-list]').evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.screenshot({path:'.tmp/composer-selectors-model-light.png',timeout:10000});
  await search.fill('claude-sonnet');
  assert.equal(await popup.getByRole('option').count(),1);
  await search.press('Enter');
  await page.getByRole('button',{name:'Change model: Claude Sonnet 4.6',exact:true}).waitFor();
  await popup.waitFor({state:'hidden'});
  const currentTrigger = page.getByRole('button',{name:'Change model: Claude Sonnet 4.6',exact:true});
  assert.ok(await currentTrigger.evaluate(el=>document.activeElement===el));
  await currentTrigger.press('ArrowDown');
  await popup.waitFor();
  assert.equal(await search.inputValue(),'');
  await search.fill('does-not-exist');
  await popup.getByText('没有匹配的模型',{exact:true}).waitFor();
  await search.press('Escape');
  await popup.waitFor({state:'hidden'});
  const effort = page.getByRole('button',{name:'更改推理级别',exact:true});
  assert.equal(await effort.evaluate(el=>getComputedStyle(el).borderRadius),'9px');
  await effort.click();
  const menu=page.getByRole('menu');
  await menu.waitFor();
  assert.equal(await menu.getByRole('menuitemradio').count(),4);
  assert.equal(await menu.getByRole('menuitemradio',{name:'关闭',exact:true}).count(),0);
  assert.equal(await menu.evaluate(el=>getComputedStyle(el).borderRadius),'12px');
  await menu.getByRole('menuitemradio',{name:'高',exact:true}).click();
  await menu.waitFor({state:'hidden'});
  assert.match(await effort.innerText(),/高/);
  await effort.click();
  const selectedEffort=page.getByRole('menuitemradio',{name:'高',exact:true});
  assert.equal(await selectedEffort.getAttribute('aria-checked'),'true');
  assert.equal(await selectedEffort.locator('svg:visible').count(),0);
  assert.equal(await selectedEffort.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(48, 48, 46)');
  assert.equal(await selectedEffort.locator('span').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  await page.screenshot({path:'.tmp/composer-selectors-reasoning-light.png',timeout:10000});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await currentTrigger.click();
  await popup.waitFor();
  await page.screenshot({path:'.tmp/composer-selectors-model-dark.png',timeout:10000});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await currentTrigger.click();
  await popup.waitFor();
  const rect=await popup.boundingBox();
  assert.ok(rect.x>=0 && rect.x+rect.width<=390 && rect.y>=0 && rect.y+rect.height<=844);
  await page.screenshot({path:'.tmp/composer-selectors-model-mobile.png',timeout:10000});
  await page.keyboard.press('Escape');
  await effort.click();
  await menu.waitFor();
  const effortRect=await menu.boundingBox();
  assert.ok(effortRect.x>=0 && effortRect.x+effortRect.width<=390);
  await page.evaluate(()=>localStorage.setItem('pi-locale','en'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Change reasoning level',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'High',exact:true}).waitFor();
  assert.equal(await page.getByRole('menuitemradio',{name:'高',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({searchByNameAndId:true,providerGroups:true,darkSelectionWithoutCheck:true,chineseAndEnglishLabels:true,singleReasoningChoice:true,unsupportedLevelsHidden:true,keyboardAndFocus:true,radii:{button:9,panel:12},mobileBounds:rect,pageErrors:errors}));
} finally {await browser.close();}
