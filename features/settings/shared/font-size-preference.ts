export const FONT_SIZE_OPTIONS = ["small", "medium", "large"] as const;
export type FontSize = typeof FONT_SIZE_OPTIONS[number];
export const DEFAULT_FONT_SIZE: FontSize = "small";
export const FONT_SIZE_STORAGE_KEY = "pi-font-size";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isFontSize(value: unknown): value is FontSize {
  return value === "small" || value === "medium" || value === "large";
}

export function normalizeFontSize(value: unknown): FontSize {
  return isFontSize(value) ? value : DEFAULT_FONT_SIZE;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getPreferredFontSize(storage: StorageLike | null = browserStorage()): FontSize {
  try {
    return normalizeFontSize(storage?.getItem(FONT_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function setPreferredFontSize(size: FontSize, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(FONT_SIZE_STORAGE_KEY, size);
  } catch {
    // The current window can still apply the selection without persistence.
  }
}

// Apply the saved preference before the first paint, including before hydration.
export const FONT_SIZE_BOOTSTRAP_SCRIPT = `(function(){var size=${JSON.stringify(DEFAULT_FONT_SIZE)};try{var saved=localStorage.getItem(${JSON.stringify(FONT_SIZE_STORAGE_KEY)});if(${JSON.stringify(FONT_SIZE_OPTIONS)}.indexOf(saved)!==-1)size=saved;}catch(e){}document.documentElement.dataset.eurekaFontSize=size;})();`;
