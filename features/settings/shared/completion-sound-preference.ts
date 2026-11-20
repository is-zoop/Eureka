// Keep the existing key so moving the control preserves the user's choice.
const KEY = "pi-sound-enabled";
const EVENT = "eureka-completion-sound-changed";

export function getCompletionSoundPreference(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(KEY);
    return stored === null || stored === "true";
  } catch {
    return true;
  }
}

export function setCompletionSoundPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, String(enabled));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

export function subscribeCompletionSoundPreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
