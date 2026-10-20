import { isToolPreset, type ToolPreset } from "./tool-presets";

// Keep the new-session default separate from the former last-used session preset.
const STORAGE_KEY = "eureka-default-tool-preset";
const PREFERENCE_EVENT = "eureka-default-tool-preset-changed";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getPreferredToolPreset(
  storage: StorageLike | null = getBrowserStorage(),
): ToolPreset {
  if (!storage) return "default";
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isToolPreset(value) ? value : "default";
  } catch {
    return "default";
  }
}

export function setPreferredToolPreset(
  preset: ToolPreset,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preset);
    if (typeof window !== "undefined" && storage === getBrowserStorage()) window.dispatchEvent(new Event(PREFERENCE_EVENT));
  } catch {
    // Browser storage is best-effort.
  }
}

export function subscribeToolPresetPreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) listener(); };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(PREFERENCE_EVENT, listener); window.removeEventListener("storage", onStorage); };
}
