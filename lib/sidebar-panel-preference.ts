export type SidebarPanel = "tasks" | "files";

const STORAGE_KEY = "pi-web:sidebar-panel";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadSidebarPanel(storage: StorageLike | null = browserStorage()): SidebarPanel {
  try {
    return storage?.getItem(STORAGE_KEY) === "files" ? "files" : "tasks";
  } catch {
    return "tasks";
  }
}

export function saveSidebarPanel(panel: SidebarPanel, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, panel);
  } catch {
    // Storage restrictions must not prevent switching sidebar panels.
  }
}
