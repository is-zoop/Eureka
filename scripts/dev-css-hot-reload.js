/* Development-only replacement for Next's mini-css-extract HMR callback.
 * Keep the current sheet until its replacement loads successfully, including
 * when the dev server is restarting or a new CSS request fails.
 */
const pending = new WeakMap();

function replaceStylesheets(doc, version = Date.now()) {
  for (const old of doc.querySelectorAll('link[rel="stylesheet"]')) {
    let url;
    try { url = new URL(old.href, doc.baseURI); } catch { continue; }
    if (url.origin !== new URL(doc.baseURI).origin || !url.pathname.startsWith('/_next/static/css/') || !url.pathname.endsWith('.css')) continue;
    if (old.isLoaded === false || pending.has(old)) continue;
    const replacement = old.cloneNode();
    replacement.isLoaded = false;
    url.searchParams.set('eureka-css-hmr', String(version));
    replacement.href = url.href;
    pending.set(old, replacement);
    let settled = false;
    const timeout = setTimeout(() => finish(false), 30000);
    timeout.unref?.();
    function finish(loaded) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pending.delete(old);
      replacement.removeEventListener('load', onLoad);
      replacement.removeEventListener('error', onError);
      if (loaded && old.parentNode) {
        replacement.isLoaded = true;
        old.parentNode.removeChild(old);
      } else {
        replacement.remove();
        // A later HMR update can retry. Never discard the last working sheet.
        old.visited = false;
      }
    }
    const onLoad = () => finish(true), onError = () => finish(false);
    replacement.addEventListener('load', onLoad);
    replacement.addEventListener('error', onError);
    if (old.parentNode) old.parentNode.insertBefore(replacement, old.nextSibling);
    else finish(false);
  }
}

module.exports = function cssHotReload() {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (typeof document !== 'undefined') replaceStylesheets(document); }, 50);
  };
};
module.exports.replaceStylesheets = replaceStylesheets;
