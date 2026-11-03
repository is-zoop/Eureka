export type DesktopUpdatePhase = "disabled" | "idle" | "checking" | "available" | "upToDate" | "downloading" | "downloaded" | "installing" | "error";
export interface DesktopUpdateState {
  enabled: boolean;
  currentVersion: string;
  phase: DesktopUpdatePhase;
  version: string | null;
  notes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  readyToInstall: boolean;
  error: string | null;
}

export function isDesktopUpdaterHost() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
async function command(name: string, version?: string): Promise<DesktopUpdateState> {
  if (!isDesktopUpdaterHost()) throw new Error("应用更新仅支持 Eureka 桌面端。");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopUpdateState>(name, version === undefined ? {} : { version });
}
export const getDesktopUpdateState = () => command("desktop_update_state");
export const checkDesktopUpdate = () => command("desktop_update_check");
export const downloadDesktopUpdate = (version: string) => command("desktop_update_download", version);
// Explicit install only. Never call from a check/download completion callback.
export const installDesktopUpdate = (version: string) => command("desktop_update_install", version);
export async function subscribeDesktopUpdate(listener: (state: DesktopUpdateState) => void) {
  if (!isDesktopUpdaterHost()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopUpdateState>("desktop-update-state", event => listener(event.payload));
}
