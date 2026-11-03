/** Self-contained Node worker source; no separate runtime asset or install step. */
export const AUTOMATION_SUPERVISOR_SOURCE = String.raw`
import { spawn } from 'node:child_process';
let worker, terminal, stopping = false, timer;
const send = message => { if (process.connected) process.send(message, () => {}); };
const hardStop = () => { if (worker) { try { worker.kill('SIGKILL'); } catch {} } else process.exit(0); };
process.on('disconnect', () => { stopping = true; hardStop(); });
process.on('message', message => {
  if (message.type === 'hard-stop') { stopping = true; hardStop(); return; }
  if (message.type === 'cancel') {
    stopping = true; if (worker?.connected) worker.send({ type: 'cancel' }, () => {});
    timer = setTimeout(hardStop, 1500); return;
  }
  if (message.type === 'reply') { if (worker?.connected) worker.send(message, () => {}); return; }
  if (message.type !== 'start' || worker || stopping) return;
  worker = spawn(process.execPath, message.workerArgs, { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  worker.on('message', value => {
    if (value?.type === 'rpc' && !terminal && !stopping) send(value);
    else if (['done', 'failed'].includes(value?.type) && !terminal) { terminal = value; hardStop(); }
  });
  worker.on('error', error => { terminal = { type: 'failed', error: '自动化脚本进程启动失败（' + (/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'UNKNOWN') + '）。' }; });
  worker.on('close', (code, signal) => {
    clearTimeout(timer);
    const result = terminal ?? { type: 'failed', error: '脚本进程退出（' + (code ?? signal) + '），没有确认完整结果。' };
    // Only report a terminal result after the application process has really exited.
    if (process.connected) process.send(result, () => process.exit(0)); else process.exit(0);
  });
  worker.once('spawn', () => { if(stopping){hardStop();return;} worker.send({ type: 'start', code: message.code, workspace: message.workspace, entry: message.entry, params: message.params, runId: message.runId, actionId: message.actionId }, error => { if (error) { terminal = { type: 'failed', error: '脚本进程通信未建立，未确认启动完成。' }; hardStop(); } }); });
});
`;
export const AUTOMATION_WORKER_SOURCE = String.raw`
import { pathToFileURL } from 'node:url';
import { relative, isAbsolute, sep, toNamespacedPath } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const abort = new AbortController(), pending = new Map(), scope = new AsyncLocalStorage();
let counter = 0, started = false;
const send = (value) => { if (process.connected) process.send(value); };
const failure = (error, phase, message) => {
  if (error?.code !== 'ERR_ACCESS_DENIED') return phase + '失败：' + (error instanceof Error ? error.message : String(error));
  const permission = typeof error.permission === 'string' && /^[A-Za-z]+$/.test(error.permission) ? error.permission : 'Unknown';
  let target = '应用目录之外';
  if (typeof error.resource === 'string' && isAbsolute(error.resource)) {
    for (const [root, label] of [[message.code, '应用代码'], [message.workspace, '应用工作区']]) {
      if (!root) continue;
      const part = relative(toNamespacedPath(root), toNamespacedPath(error.resource));
      if (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)) { target = label + (part ? '/' + part.split(sep).join('/').replace(/[\r\n\t]/g, ' ').slice(0, 160) : ''); break; }
    }
  }
  return phase + '失败（ERR_ACCESS_DENIED；' + permission + '；目标：' + target + '）。';
};
const rpc = (method, args = []) => new Promise((resolve, reject) => {
  if (abort.signal.aborted) return reject(new Error('运行已停止。'));
  const requestId = ++counter; pending.set(requestId, { resolve, reject });
  send({ type: 'rpc', requestId, method, args, context: scope.getStore() ?? null });
});
const stop = () => { abort.abort(); for (const item of pending.values()) item.reject(new Error('运行已停止。')); pending.clear(); };
process.on('disconnect', () => { stop(); process.exit(75); });
process.on('message', async message => {
  if (message.type === 'cancel') { stop(); return; }
  if (message.type === 'reply') { const item = pending.get(message.requestId); if (!item) return; pending.delete(message.requestId); message.error ? item.reject(new Error(message.error)) : item.resolve(message.value); return; }
  if (message.type !== 'start' || started) return; started = true;
  try { if (process.cwd() !== message.workspace) process.chdir(message.workspace); }
  catch (error) { send({ type: 'failed', error: failure(error, '进入应用工作区', message) + ' 未执行应用入口。' }); return; }
  const child = (ref, relative) => ({ grantId: ref.grantId, relative: [ref.relative, relative].filter(Boolean).join('/') });
  const ctx = Object.freeze({
    params: message.params, config: message.params, runId: message.runId, action: message.actionId, signal: abort.signal,
    log: (text) => rpc('log', [String(text)]),
    sleep: (ms) => new Promise((resolve, reject) => { if (!Number.isFinite(ms) || ms < 0 || ms > 60000) return reject(new Error('等待时间应为 0～60000 毫秒。')); if (abort.signal.aborted) return reject(new Error('运行已停止。')); const cancel = () => { clearTimeout(timer); reject(new Error('运行已停止。')); }; const timer = setTimeout(() => { abort.signal.removeEventListener('abort', cancel); resolve(); }, ms); abort.signal.addEventListener('abort', cancel, { once: true }); }),
    step: async (nodeId, input, work) => {
      const token = await rpc('step-start', [nodeId, input ?? null]);
      return scope.run(token, async () => { try { const output = await work(); await rpc('step-end', [token, output ?? null]); return output; } catch (error) { if (!abort.signal.aborted) await rpc('step-error', [token, error instanceof Error ? error.message : String(error)]).catch(() => {}); throw error; } });
    },
    files: Object.freeze({ workspace: { grantId: 'workspace' }, child,
      list: (ref) => rpc('files.list', [ref]), readText: (ref) => rpc('files.readText', [ref]), readJson: (ref) => rpc('files.readJson', [ref]),
      readBytes: async (ref) => Buffer.from(await rpc('files.readBase64', [ref]), 'base64'), writeBytes: (ref, bytes, overwrite = false) => rpc('files.writeBase64', [ref, Buffer.from(bytes).toString('base64'), overwrite]),
      writeText: (ref, text, overwrite = false) => rpc('files.writeText', [ref, text, overwrite]), writeJson: (ref, value, overwrite = false) => rpc('files.writeJson', [ref, value, overwrite]),
      mkdir: (ref) => rpc('files.mkdir', [ref]), copy: (from, to) => rpc('files.copy', [from, to]), move: (from, to) => rpc('files.move', [from, to]) }),
    artifacts: Object.freeze({ write: (name, text, mediaType = 'text/plain') => rpc('artifact', [name, text, mediaType]) }),
    ask: (questions) => rpc('ask', [questions]),
    ai: (ruleId,input,options) => rpc('ai',options === undefined ? [ruleId,input] : [ruleId,input,options]),
    browser: Object.freeze({ connect: (siteId) => rpc('browser.connect', [siteId]), release: () => rpc('browser.release'),
      observe: () => rpc('browser.observe'), locate: locator => rpc('browser.locate', [locator]), read: field => rpc('browser.read', [field]), extract: spec => rpc('browser.extract', [spec]),
      navigate: url => rpc('browser.navigate', [url]), operation: (id, input = {}) => rpc('browser.operation', [id, input]),
      waitFor: async (field, expected, timeout = 10000) => { if(!Number.isFinite(timeout)||timeout<0||timeout>30000)throw new Error('网页等待时间应为 0～30000 毫秒。'); const deadline = Date.now() + timeout; do { const value = await rpc('browser.read', [{...field,optional:true}]); if (JSON.stringify(value) === JSON.stringify(expected)) return value; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < deadline && !abort.signal.aborted); throw new Error('页面未在时限内满足读取条件；未重复任何查询或变更操作。'); } })
  });
  let phase = '加载应用代码';
  try {
    const mod = await import(pathToFileURL(message.entry).href);
    if (typeof mod.default !== 'function') throw new Error('入口需要默认导出 async function run(ctx)。');
    phase = '执行应用代码';
    const result = await mod.default(ctx);
    if (pending.size) throw new Error('脚本返回时仍有未等待的 SDK 操作，请使用 await。');
    send({ type: 'done', result: result ?? null });
  } catch (error) { send({ type: 'failed', error: failure(error, phase, message) }); }
});
`;
