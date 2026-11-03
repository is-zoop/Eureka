// Fixed, read-only collector. Never accepts code/selectors from a page or model.
(() => {
  try {
    const clean = (value, limit = 300) => String(value || '').replace(/https?:\/\/[^\s<>"']+/g, raw => {
      try { const u = new URL(raw); return u.origin + u.pathname; } catch { return '[URL]'; }
    }).replace(/\s+/g, ' ').trim().slice(0, limit);
    const ignored = 'script,style,noscript,template,input,textarea,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]';
    const visible = el => {
      if (!el || el.closest(ignored)) return false;
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const textOf = el => {
      const parts = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node, count = 0;
      while ((node = walker.nextNode()) && count++ < 300) {
        if (visible(node.parentElement)) parts.push(node.textContent);
      }
      return clean(parts.join(' '));
    };
    const text = [], walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node, visited = 0, length = 0;
    while ((node = walker.nextNode()) && visited++ < 12000 && length < 16000) {
      if (!visible(node.parentElement)) continue;
      const value = clean(node.textContent, 1000);
      if (value) { text.push(value); length += value.length + 1; }
    }
    const elements = [], refs = {};
    const signature = el => [el.tagName, el.getAttribute('role'), el.getAttribute('name'), el.getAttribute('type'), el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.textContent?.slice(0, 1200)].join('|');
    for (const el of document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,th,td')) {
      if (elements.length >= 120) break;
      // Input labels/types are useful, but values are deliberately never read.
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      if (el.closest('[hidden],[aria-hidden="true"],script,style') || getComputedStyle(el).visibility === 'hidden') continue;
      const tag = el.tagName.toLowerCase(), type = el.getAttribute('type') || '';
      if (type === 'hidden' || type === 'password') continue;
      const label = clean(el.getAttribute('aria-label') || (el.labels ? [...el.labels].map(l => textOf(l)).join(' ') : '') || el.getAttribute('placeholder') || textOf(el));
      const ref = `e${elements.length + 1}`;
      refs[ref] = { el, signature: signature(el), x: r.x, y: r.y, width: r.width, height: r.height };
      elements.push({ ref, role: clean(el.getAttribute('role') || tag, 40), label, type: clean(type, 30), disabled: Boolean(el.disabled), ...(tag === 'select' ? { options: [...el.options].filter(o => !o.disabled).slice(0, 40).map(o => clean(o.label)) } : {}), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
    }
    const frames = [...document.querySelectorAll('iframe')].filter(el => el.getBoundingClientRect().width > 0).length;
    const documentKey = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
    // Local element handles only; never expose DOM objects or form values to the model.
    window.__eurekaObservation = { key: documentKey, refs, signature, url: location.href, at: Date.now(), used: false };
    return { documentKey, title: clean(document.title, 200), url: location.origin + location.pathname, text: text.join('\n').slice(0, 16000), elements, viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, limitations: ['viewport-only', 'input-values-omitted', 'shadow-dom-not-traversed', ...(frames ? ['iframe-content-not-read'] : []), ...(node || elements.length >= 120 ? ['content-may-be-truncated'] : [])] };
  } catch { return { error: 'collection-failed' }; }
})()
