import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8080';
const cwd = 'E:\\Eureka';
const now = new Date().toISOString();
const sessions = Array.from({length: 36}, (_, i) => ({
  id: `sidebar-qa-${i}`, path: `${cwd}\\qa-${i}.jsonl`, cwd, projectRoot: cwd,
  name: i === 0 ? '唯品昨日店铺销售业绩汇总' : `侧栏布局检查任务 ${i + 1}`,
  firstMessage: '侧栏交互检查', created: now, modified: now, messageCount: 2,
}));
const browser = await chromium.launch({headless: true, executablePath: chromium.executablePath()});
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'zh-CN'});
  await context.addCookies([{name:'eureka_guest_session',value:'1',url:base}]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let data = {};
    switch(url.pathname) {
      case '/api/sessions': data = {sessions, runningSessionIds: []}; break;
      case '/api/home': data = {home:'C:\\Users\\Dominic'}; break;
      case '/api/cwd/validate': data = {cwd}; break;
      case '/api/agent/running': data = {runningSessionIds:[]}; break;
      case '/api/worktrees': data = {projectRoot:cwd,isGit:true,branch:'main',isTopLevel:true,currentWorktreePath:cwd,worktrees:[{path:cwd,branch:'main',isMain:true}]}; break;
      case '/api/models': data = {models:[],modelList:[],defaultModel:null}; break;
      case '/api/git/status': data = {files:[],isGit:true}; break;
      default:
        if(url.pathname.startsWith('/api/files/')) {
          const nested = decodeURIComponent(url.pathname).replaceAll('\\','/').includes('/docs');
          data = {entries:nested ? [{name:'README.md',isDir:false,size:42,modified:now}] : [
            ...['.pi','.pnpm-store','apps','artifacts','deploy','docs','packages'].map(name=>({name,isDir:true,size:0,modified:now})),
            ...Array.from({length:24},(_,i)=>({name:`example-${i}.ts`,isDir:false,size:42,modified:now})),
          ]};
        } else if(url.pathname.startsWith('/api/sessions/')) data = {messages:[],entryIds:[],cwd,leafId:null};
    }
    await route.fulfill({json:data});
  });
  await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`,{waitUntil:'domcontentloaded',timeout:60000});
  const tasks = page.getByRole('tab',{name:'任务',exact:true});
  const files = page.getByRole('tab',{name:'文件',exact:true});
  await tasks.waitFor({timeout:60000});
  await page.getByText('侧栏布局检查任务 2',{exact:true}).waitFor();
  assert.equal(await tasks.getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('tabpanel').count(),1);
  const taskList = page.locator('.sidebar-task-list');
  const taskHeight = await taskList.evaluate(el=>el.clientHeight);
  assert.ok(taskHeight>450,`Task list is too short: ${taskHeight}`);
  await taskList.evaluate(el=>{el.scrollTop=240;});
  const scroll = await taskList.evaluate(el=>el.scrollTop);
  await files.click();
  await page.getByText('docs',{exact:true}).waitFor();
  assert.equal(await page.getByRole('tabpanel').count(),1);
  await page.getByText('docs',{exact:true}).click();
  await page.getByText('README.md',{exact:true}).waitFor();
  const fileList = page.getByRole('tabpanel').locator('[class*="fileList"]');
  const fileHeight = await fileList.evaluate(el=>el.clientHeight);
  await fileList.evaluate(el=>{el.scrollTop=100;});
  const fileScroll = await fileList.evaluate(el=>el.scrollTop);
  await tasks.click();
  assert.equal(await taskList.evaluate(el=>el.scrollTop),scroll);
  await files.click();
  assert.equal(await fileList.evaluate(el=>el.scrollTop),fileScroll);
  assert.ok(await page.getByText('README.md',{exact:true}).isVisible());
  await fileList.evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:'.tmp/sidebar-tabs-files.png'});
  await tasks.click();
  await page.getByRole('button',{name:'搜索任务',exact:true}).click();
  const search = page.getByRole('textbox',{name:'搜索任务',exact:true});
  await search.fill('唯品');
  await files.click();
  await tasks.click();
  assert.equal(await search.inputValue(),'唯品');
  assert.equal(await page.getByText('侧栏布局检查任务 2',{exact:true}).count(),0);
  await search.press('Escape');
  await tasks.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await files.getAttribute('aria-selected'),'true');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('tab',{name:'文件',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('文件'));
  await tasks.click();
  await page.screenshot({path:'.tmp/sidebar-tabs-tasks.png'});
  await page.setViewportSize({width:390,height:844});
  const showSidebar = page.getByRole('button',{name:'显示侧边栏',exact:true});
  await showSidebar.waitFor({state:'visible'});
  await showSidebar.click();
  await files.waitFor({state:'visible'});
  await files.click();
  const narrowBounds = await files.boundingBox();
  assert.ok(narrowBounds && narrowBounds.x>=0 && narrowBounds.x+narrowBounds.width<=390);
  await page.screenshot({path:'.tmp/sidebar-tabs-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({taskHeight,fileHeight,taskScrollPreserved:scroll,fileScrollPreserved:fileScroll,folderStatePreserved:true,searchPreserved:true,keyboardPassed:true,reloadPreference:true,narrowLayout:true,pageErrors:errors}));
} finally {
  await browser.close();
}
