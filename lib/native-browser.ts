export interface NativeBrowserSpec { sessionId: string; ownerKey: string; websiteUrl: string; accountId?: string; browserMode?: "temporary"; applicationId?: string; applicationRunId?: string; applicationSiteId?: string; applicationTaskId?: string }
export function sameNativeBrowser(a: NativeBrowserSpec | null | undefined, b: NativeBrowserSpec | null | undefined) {
  return Boolean(a && b && a.sessionId === b.sessionId && a.ownerKey === b.ownerKey && a.websiteUrl === b.websiteUrl && a.accountId === b.accountId && a.browserMode === b.browserMode && a.applicationId === b.applicationId && a.applicationRunId === b.applicationRunId && a.applicationSiteId === b.applicationSiteId && a.applicationTaskId === b.applicationTaskId);
}
export interface NativeBrowserSnapshot { opened: boolean; active?: boolean; title: string; url: string; loading: boolean; controlled?: boolean; notice?: string | null; zoomPercent?: number }
export interface NativeBrowserBounds { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number }
export interface NativeBrowserOverlay { blockInput: boolean; dimAlpha: number; cutouts: Array<{ x: number; y: number; width: number; height: number; radius: number }> }
export function isDesktopBrowserHost() { return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window; }
// Observation must not block lifecycle commands such as stop/close.
export async function nativeBrowserObservation(spec: NativeBrowserSpec, options: { screenshot?: boolean; expectedId?: string }) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<unknown>("desktop_automation_observe", { owner: spec.ownerKey, sessionId: spec.sessionId, ...options });
}

export async function nativeBrowserControl(spec: NativeBrowserSpec, mode: "claim" | "pause", token: string, sequence: number, expectedId?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("desktop_automation_control", { owner: spec.ownerKey, sessionId: spec.sessionId, mode, token, sequence, expectedId });
}
export async function nativeBrowserApplication(spec: NativeBrowserSpec, token: string, payload: string, ticket: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<unknown>("desktop_automation_app", { owner: spec.ownerKey, sessionId: spec.sessionId, token, payload, ticket });
}

// Serialize lifecycle calls as React mounts/unmounts views during navigation.
let commands: Promise<unknown> = Promise.resolve();
export function nativeBrowserCommand(spec: NativeBrowserSpec, action: string, options?: { url?: string; bounds?: NativeBrowserBounds; zoomPercent?: number; overlay?: NativeBrowserOverlay }) {
  const task = commands.catch(() => {}).then(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NativeBrowserSnapshot>("desktop_automation_browser", {
      owner: spec.ownerKey, sessionId: spec.sessionId, accountId: spec.accountId, temporary: spec.browserMode === "temporary", action, ...options,
    });
  });
  commands = task.catch(() => {});
  return task;
}

export function browserSlotBounds(element: HTMLElement): NativeBrowserBounds | null {
  const rect = element.getBoundingClientRect();
  const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
  const width = Math.min(window.innerWidth, rect.right) - x;
  const height = Math.min(window.innerHeight, rect.bottom) - y;
  if (!element.getClientRects().length || width < 1 || height < 1) return null;
  return { x, y, width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
}

// Only popup rectangles become holes in the native child window. A modal's
// backdrop dims the remaining website natively, without hiding its live view.
export function browserOverlay(bounds: NativeBrowserBounds): NativeBrowserOverlay {
  let blockInput = false, dimOpacity = 0, modalDialog = false;
  const cutouts: NativeBrowserOverlay["cutouts"] = [];
  const elements = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-desktop-menu-popup], [data-native-browser-modal], [data-native-browser-overlay]');
  for (const element of elements) {
    // Base UI can keep a closed popup mounted, and author CSS may override
    // the browser's default [hidden] display rule. Geometry alone is not state.
    // aria-hidden/inert can merely indicate a modal's accessibility boundary;
    // its visible backdrop must still dim the native website.
    if (element.closest('[hidden], [data-closed], [data-state="closed"]')) continue;
    if (!element.getClientRects().length) continue;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    if (element.hasAttribute("data-native-browser-modal")) {
      blockInput = true;
      // Computed colors may use rgba(..., alpha) or color(... / alpha).
      const color = style.backgroundColor;
      const alpha = color.match(/(?:rgba\([^)]*,\s*|\/\s*)([\d.]+)(%)?\s*\)$/);
      const backgroundOpacity = color === "transparent" ? 0 : alpha ? Number(alpha[1]) / (alpha[2] ? 100 : 1) : 1;
      const opacity = Math.max(0, Math.min(1, backgroundOpacity * Number(style.opacity)));
      dimOpacity = 1 - (1 - dimOpacity) * (1 - opacity);
      continue;
    }
    const role = element.getAttribute("role");
    if ((role === "dialog" || role === "alertdialog") && (element.getAttribute("aria-modal") === "true" || role === "alertdialog" && element.getAttribute("aria-modal") !== "false")) { blockInput = true; modalDialog = true; }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left >= bounds.x + bounds.width || rect.right <= bounds.x || rect.top >= bounds.y + bounds.height || rect.bottom <= bounds.y) continue;
    // Keep the original rounded rectangle, even across the slot boundary.
    // Native region subtraction clips it to the website; padding would expose
    // the host backdrop as an artificial gray frame around the popup.
    const x = rect.left - bounds.x, y = rect.top - bounds.y;
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    const radius = Math.min(rect.width / 2, rect.height / 2, ...radii.map(value => /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : 0));
    const next = { x, y, width: rect.width, height: rect.height, radius };
    if (cutouts.some(r => r.x === x && r.y === y && r.width === next.width && r.height === next.height && r.radius === radius)) continue;
    cutouts.push(next);
  }
  if (modalDialog && dimOpacity === 0) dimOpacity = document.documentElement.classList.contains("dark") ? 0.6 : 0.35;
  return { blockInput: blockInput || cutouts.length > 0, dimAlpha: Math.round(dimOpacity * 255), cutouts: cutouts.slice(0, 64) };
}
