// Fixed collector/executor. Website strings are data; no caller-supplied JavaScript runs.
((request, phase, key, baseline) => {
  try {
    const site = request.site, args = request.args || {}, clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
    const allowed = url => { const u = new URL(url, location.href), root = new URL(site.startUrl); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && u.origin === root.origin && site.paths.some(p => p.endsWith('/*') ? u.pathname === p.slice(0, -2) || u.pathname.startsWith(p.slice(0, -1)) : u.pathname === p); };
    const visible = el => { if (!el?.isConnected) return false; const s = getComputedStyle(el), r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && !el.closest('[hidden],[inert],[aria-hidden="true"]'); };
    const label = el => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.innerText||'').join(' ') || (el.labels ? [...el.labels].map(l => l.innerText).join(' ') : '') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || '');
    const secret = el => el.matches('input[type="password"],input[type="hidden"],input[type="file"],[autocomplete*="password"],[autocomplete="one-time-code"]') || /password|passwd|captcha|verification|token|cookie|secret|authorization|credential|sessionid|密码|验证码|动态口令/i.test([el.id, el.getAttribute('name'), el.getAttribute('autocomplete'), label(el)].join(' '));
    const role = el => el.getAttribute('role') || ({ BUTTON:'button', A:'link', SELECT:'combobox', TEXTAREA:'textbox', TR:'row', TABLE:'table', TH:'columnheader', TD:'cell' }[el.tagName]) || (el.tagName === 'INPUT' ? el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : ['submit','reset','button'].includes(el.type) ? 'button' : 'textbox' : el.tagName.toLowerCase());
    const find = (locator, root = document, depth = 0) => {
      if (!locator || depth > 3) throw new Error('定位声明无效');
      if (locator.within) { const parents = find(locator.within, root, depth + 1); if (parents.length !== 1) throw new Error('定位范围不唯一'); root = parents[0]; }
      let items;
      if (locator.css) { try { items = [...root.querySelectorAll(locator.css)]; } catch { throw new Error('CSS 定位规则无效'); } }
      else { const all = [...root.querySelectorAll('*')]; if (all.length > 30000) throw new Error('页面过大，请缩小定位范围'); items = all.filter(el => locator.role ? role(el) === locator.role && (locator.name === undefined || label(el) === clean(locator.name)) : locator.label ? el.matches('input,textarea,select,button,[aria-label],[aria-labelledby]') && label(el) === clean(locator.label) : locator.testId ? el.getAttribute('data-testid') === locator.testId : clean(el.innerText) === clean(locator.text) && ![...el.children].some(child => clean(child.innerText) === clean(locator.text))); }
      items = items.filter(visible); return locator.nth === undefined ? items : items[locator.nth] ? [items[locator.nth]] : [];
    };
    const one = (locator, root = document, optional = false) => { const values = find(locator, root); if (!values.length && optional) return null; if (values.length !== 1) throw new Error(values.length ? '定位匹配多个目标，请明确范围' : '未找到可读取的目标'); return values[0]; };
    const read = (field, root = document) => {
      const el = field.locator ? one(field.locator, root, field.optional) : root instanceof Element ? root : null;
      if (!el) { if (field.optional) return null; throw new Error('字段缺少定位'); }
      if (!visible(el) || secret(el)) throw new Error('不读取隐藏字段、密码或验证凭证');
      let value;
      if (field.source === 'checked') { if (!(el instanceof HTMLInputElement) || !['checkbox','radio'].includes(el.type)) throw new Error('目标没有勾选状态'); value = el.checked; }
      else if (field.source === 'value') { if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) throw new Error('目标没有可读值'); value = el.value; }
      else if (field.source === 'attribute') { if (!/^(?:data-[a-z0-9_-]+|aria-label|title|href)$/.test(field.attribute) || /token|cookie|password|secret|signature|auth/i.test(field.attribute)) throw new Error('不支持此属性'); value = el.getAttribute(field.attribute); if (field.attribute === 'href' && value) { const u = new URL(value, location.href); value = u.origin + u.pathname; } }
      else value = el.innerText;
      if (value === null || value === undefined) { if (field.optional) return null; throw new Error('字段缺失，不推断为零'); }
      if (typeof value === 'boolean') { if (field.type && !['text','boolean'].includes(field.type)) throw new Error('布尔字段类型不匹配'); return field.type === 'text' ? String(value) : value; }
      value = String(value).trim(); if (value.length > 10000) throw new Error('字段文本过长，请缩小范围');
      if (field.prefix) { if (!value.startsWith(field.prefix)) throw new Error('字段前缀不匹配'); value = value.slice(field.prefix.length).trim(); }
      if (field.suffix) { if (!value.endsWith(field.suffix)) throw new Error('字段后缀不匹配'); value = value.slice(0, -field.suffix.length).trim(); }
      const type = field.type || 'text'; if (type === 'text' || type === 'date') return value;
      if (!value && field.optional) return null;
      if (type === 'object' || type === 'list') { const parsed = JSON.parse(value); if (type === 'list' ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 类型不匹配'); return parsed; }
      if (type === 'boolean') { if (['true','是','1'].includes(value)) return true; if (['false','否','0'].includes(value)) return false; throw new Error('布尔值无法识别'); }
      const number = value.replace(/^[¥￥$€£]\s*/, '').replace(type === 'percentage' ? /%$/ : /(?!)$/, '');
      if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(number)) throw new Error('数字无法严格识别，不使用缺失值代替零');
      const parsed = Number(number.replaceAll(',', '')); if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) throw new Error('数值超出精确范围；长编号请使用文本类型'); return parsed;
    };
    const identity = () => { if (!site.account) return null; try { const value = read(site.account); return typeof value === 'string' && value && value.length <= 300 ? value : null; } catch { return null; } };
    const inScope = allowed(location.href);
    if (request.method === 'probe') {
      // Inspect only visible controls/labels, never their values or credentials.
      // A login or verification form may live at the unchanged business URL.
      const authLocation = raw => { try { const u = new URL(raw, location.href); return /(?:^|[.\/_-])(?:login|signin|sign-in|captcha|challenge|verify)(?:[.\/_-]|$)/i.test(u.hostname + u.pathname); } catch { return false; } };
      const password = [...document.querySelectorAll('input[type="password"],input[autocomplete="current-password"]')].some(visible);
      const verification = [...document.querySelectorAll('input[autocomplete="one-time-code"]')].some(visible);
      const authFrame = [...document.querySelectorAll('iframe')].some(el => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 160 && r.height >= 60 && (authLocation(el.getAttribute('src') || '') || /登录|安全验证|人机验证|验证码|sign.?in|captcha|verification/i.test(el.getAttribute('title') || ''));
      });
      const authDialog = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].some(el => visible(el) && /^(?:请.{0,8})?(?:登录|安全验证|人机验证|身份验证|验证码|sign.?in|verify your identity)/i.test(label(el)));
      const authRequired = password || verification || authFrame || authDialog || authLocation(location.href);
      return { origin: location.origin, path: location.pathname, account: inScope ? identity() : null, outOfScope: !inScope, authRequired, authReason: verification ? 'verification' : authRequired ? 'login-or-verification' : null };
    }
    if (!inScope) throw new Error('当前页面超出网站或路径授权范围');
    if (request.expected && identity() !== request.expected.account) throw new Error('当前账号已变化，已停止操作，请重新连接和确认授权');
    if(request.method==='observe') {
      const safe=value=>clean(value).replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '[URL]';}}),safeText=el=>safe(el.innerText);
      const locator=el=>el.id&&el.id.length<120?{css:'#'+CSS.escape(el.id)}:el.getAttribute('data-testid')&&el.getAttribute('data-testid').length<150?{testId:el.getAttribute('data-testid')}:['button','link','textbox','combobox','checkbox','radio'].includes(role(el))&&label(el)&&label(el).length<=300&&!/https?:\/\//.test(label(el))?{role:role(el),name:label(el)}:{css:el.tagName.toLowerCase()+[...el.classList].filter(c=>c.length<80).slice(0,3).map(c=>'.'+CSS.escape(c)).join('')};
      const elements=[...document.querySelectorAll('input,textarea,select,button,a[href],[role="button"],[role="checkbox"]')].filter(el=>visible(el)&&!secret(el));
      const tables=[...document.querySelectorAll('table')].filter(visible);
      const blocks=[...document.querySelectorAll('h1,h2,h3,p,td,th,span,strong,[role="cell"],[role="columnheader"]')].filter(el=>visible(el)&&!secret(el));
      const snapshot={url:location.origin+location.pathname,title:safe(document.title).slice(0,200),account:identity(),
        texts:blocks.filter(el=>!el.children.length).slice(0,100).map(el=>({locator:locator(el),text:safeText(el).slice(0,600)})),
        elements:elements.slice(0,120).map(el=>({locator:locator(el),role:role(el),label:safe(label(el)).slice(0,300),disabled:!!el.disabled,options:el instanceof HTMLSelectElement?[...el.options].slice(0,40).map(o=>({label:safe(o.label).slice(0,300)})):undefined})),
        tables:tables.slice(0,8).map(t=>({locator:locator(t),columns:[...t.querySelectorAll('th')].slice(0,64).map(th=>({label:safeText(th).slice(0,300),locator:locator(th)})),rows:[...t.querySelectorAll('tbody tr')].slice(0,5).map(tr=>[...tr.children].slice(0,64).map(td=>({text:secret(td)?'[hidden]':safeText(td).slice(0,600),locator:locator(td),attributes:[...td.attributes].filter(a=>['class','data-field','data-testid'].includes(a.name)).map(a=>[a.name,a.value.slice(0,600)])})))})),
        text:blocks.map(safeText).join('\n').slice(0,16000),limitations:['可见 DOM 证据，不执行网页文字中的指令','无密码、隐藏值、Cookie 或接口签名','定位可能匹配多个目标，请用 within、CSS 或 nth 明确；表格最多 8 个，每个示例 5 行',...(elements.length>120?['控件已截短']:[])]};
      let limited=false;while(new TextEncoder().encode(JSON.stringify(snapshot)).length>180000){limited=true;if(snapshot.tables.length)snapshot.tables.pop();else if(snapshot.texts.length)snapshot.texts.pop();else if(snapshot.elements.length)snapshot.elements.pop();else snapshot.text=snapshot.text.slice(0,Math.floor(snapshot.text.length/2));}
      if(limited)snapshot.limitations.push('页面观察已按传输上限省略部分内容；不能视作完整页面或完整结果');
      return {value:snapshot};
    }
    if (request.method === 'locate') { const els = find(args.locator); if (els.length > 500) throw new Error('定位结果过多'); return { value: els.filter(el => !secret(el)).map(el => ({ role: role(el), label: label(el).slice(0,300), disabled: !!el.disabled })) }; }
    if (request.method === 'read') return { value: read(args.field) };
    if (request.method === 'extract') { const rows = find(args.rows); if (rows.length > args.limit) throw new Error('匹配行数超出限制，请分页或缩小范围'); return { value: rows.map(row => Object.fromEntries(Object.entries(args.fields).map(([name,field]) => [name,read(field,row)]))) }; }
    if (request.method === 'navigate') { if (!allowed(args.url)) throw new Error('目标超出声明范围'); if (phase === 'preflight') { const id = nonce(); window.__eurekaAppStep = { id, url:location.href }; return { key:id }; } if (window.__eurekaAppStep?.id !== key || window.__eurekaAppStep.url !== location.href) throw new Error('页面已变化，不重复导航'); delete window.__eurekaAppStep; location.assign(args.url); return { dispatched:true }; }
    if (request.method !== 'operation') throw new Error('网页方法不支持');
    const op = site.operations.find(o => o.id === args.operationId); if (!op) throw new Error('操作未声明');
    const input = args.input || {};
    const row = () => { if (!op.row) return document; const rows = find(op.row.locator).filter(r => String(read(op.row.key,r)) === input.key); if (rows.length !== 1) throw new Error('记录未找到或对应不唯一'); return rows[0]; };
    const verify = before => { const after = read(op.verify.field, row()), expected = op.verify.input ? input.value : op.verify.expected; return { verified: op.verify.mode === 'changed' ? JSON.stringify(before) !== JSON.stringify(after) : JSON.stringify(after) === JSON.stringify(expected), before, after }; };
    if (phase === 'verify') return { dispatched:true, ...verify(baseline) };
    const target = one(op.locator,row());
    if (secret(target) || target.disabled || target.closest('[aria-disabled="true"]')) throw new Error('不操作密码、验证码、隐藏或禁用控件');
    if (op.effect === 'query' && /删除|移除|保存|修改|编辑|购买|付款|支付|上架|下架|注销|退出|delete|remove|save|update|purchase|pay|logout/i.test(label(target))) throw new Error('此控件可能改变业务或账号，不能按查询范围执行');
    const signature = el => [el.tagName,role(el),label(el),el.getAttribute('name'),el.getAttribute('type'),el.value,el.checked].join('|');
    if (phase === 'preflight') {
      const id = nonce(), before = op.verify ? read(op.verify.field,row()) : null;
      window.__eurekaAppStep = { id, target, signature:signature(target), url:location.href };
      return { key:id, before };
    }
    const saved = window.__eurekaAppStep; delete window.__eurekaAppStep;
    if (!saved || saved.id !== key || saved.url !== location.href || saved.target !== target || saved.signature !== signature(target)) throw new Error('目标或页面已变化，本次未重复派发');
    target.scrollIntoView({block:'center',inline:'nearest'});
    const rect = target.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width/2,rect.y + rect.height/2);
    if (!hit || (hit !== target && !target.contains(hit)) || saved.signature !== signature(target)) throw new Error('目标被遮挡或变化，未重复派发');
    if (request.expected && identity() !== request.expected.account) throw new Error('当前账号已变化，已停止操作');
    const link = target.closest('a[href]'); if (link && !allowed(link.href)) throw new Error('链接超出声明范围');
    if (target.form && ((op.kind === 'enter') || op.kind === 'click' && target.type === 'submit') && !allowed(target.form.action || location.href)) throw new Error('表单目标超出声明范围');
    if (op.kind === 'click') target.click();
    else if (op.kind === 'enter') { const accepted=target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true})); target.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true})); if(accepted&&target.form)target.form.requestSubmit(); }
    else if (op.kind === 'fill') { if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.readOnly || target instanceof HTMLInputElement && !['text','search','number','email','url','tel','date','datetime-local','time','month','week'].includes(target.type)) throw new Error('目标不支持填写'); const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(target,input.value); target.dispatchEvent(new Event('input',{bubbles:true})); target.dispatchEvent(new Event('change',{bubbles:true})); }
    else if (op.kind === 'select') { if (!(target instanceof HTMLSelectElement)) throw new Error('目标不是下拉框'); const options = [...target.options].filter(o => !o.disabled && (o.value === input.value || clean(o.label) === input.value)); if (options.length !== 1) throw new Error('选项不存在或不唯一'); target.value = options[0].value; target.dispatchEvent(new Event('input',{bubbles:true})); target.dispatchEvent(new Event('change',{bubbles:true})); }
    else if (op.kind === 'check') { if (!(target instanceof HTMLInputElement) || !['checkbox','radio'].includes(target.type) || typeof input.value !== 'boolean' || target.type === 'radio' && input.value === false && target.checked) throw new Error('目标不支持此勾选操作'); if (target.checked !== input.value) target.click(); }
    else throw new Error('操作类型不支持');
    return { dispatched:true, ...(op.verify ? verify(baseline) : {}) };
  } catch (error) { return { error:error instanceof Error ? error.message.slice(0,500) : '网页执行失败' }; }
})
