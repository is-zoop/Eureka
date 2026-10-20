const KEY = "eureka-clarification-enabled";
const EVENT = "eureka-clarification-preference-changed";
// Like composer drafts, failed submissions live only in browser memory. Editing
// the request makes it a new submission and reads the latest preference again.
const retries = new Map<string, { text: string; enabled: boolean }>();
export function submissionClarificationPreference(key: string | undefined, text: string): boolean {
  const previous = key ? retries.get(key) : undefined;
  return previous?.text === text ? previous.enabled : getClarificationPreference();
}
export function rememberClarificationSubmission(key: string | undefined, text: string, enabled: boolean): void {
  if (key) retries.set(key, { text, enabled });
}
export function forgetClarificationSubmission(key: string | undefined): void { if (key) retries.delete(key); }
export function getClarificationPreference(): boolean {
  try { return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "true"; } catch { return false; }
}
export function setClarificationPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, String(enabled)); window.dispatchEvent(new Event(EVENT)); } catch { /* best effort */ }
}
export function subscribeClarificationPreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", onStorage); };
}
