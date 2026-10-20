export interface BrowserTab { id: string; title: string; url: string; loading: boolean }
export interface BrowserState { sessionId: string; tabs: BrowserTab[]; activeTabId: string | null; error?: string; openRevision?: number }
export type BrowserEvent = { type: "state"; state: BrowserState } | { type: "frame"; tabId: string; data: string; width: number; height: number };
export type BrowserAction =
  | { action: "open"; url?: string }
  | { action: "new-tab"; url?: string }
  | { action: "select-tab" | "close-tab"; tabId: string }
  | { action: "navigate"; tabId: string; url: string }
  | { action: "back" | "forward" | "reload"; tabId: string }
  | { action: "resize"; tabId: string; width: number; height: number }
  | { action: "mouse"; tabId: string; kind: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"; x: number; y: number; button?: "left" | "middle" | "right"; buttons?: number; deltaX?: number; deltaY?: number; clickCount?: number }
  | { action: "key"; tabId: string; kind: "keyDown" | "keyUp"; key: string; code: string; modifiers: number }
  | { action: "text"; tabId: string; text: string };
