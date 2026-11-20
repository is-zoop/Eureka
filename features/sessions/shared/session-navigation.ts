/** Reflect client-owned session selection without requesting a new RSC page. */
export function replaceSessionUrl(sessionId: string | null): void {
  const { pathname, search, hash } = window.location;
  const url = sessionId ? `${pathname}?session=${encodeURIComponent(sessionId)}` : pathname;
  if (`${pathname}${search}${hash}` === url) return;

  // Next patches the native History API to synchronize useSearchParams while
  // preserving its own history state. Passing null lets that adapter run;
  // router.replace would re-enter the server page and its Suspense boundary.
  window.history.replaceState(null, "", url);
}
