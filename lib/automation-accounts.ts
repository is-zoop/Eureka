export const DEFAULT_BROWSER_ID = "00000000000000000000000000000000";
export interface WebsiteAccount {
  id: string; name: string; origin: string;
  status: "unverified" | "confirmed" | "needs_login";
  createdAt: number; confirmedAt: number | null; lastUsedAt: number | null;
  deleted: boolean; cleanupPending: boolean; inUse: boolean;
  passwordAutosave: boolean;
}
export async function accountCommand(owner: string, action: "list" | "create" | "update" | "reset" | "delete" | "cleanup" | "passwords", options: { id?: string; name?: string; origin?: string; enabled?: boolean } = {}) {
  // Derive ownership from the active authenticated application session before
  // every command, including list/confirm. Never reuse another user's UI state.
  const response = await fetch("/api/automation/identity", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const identity = await response.json();
  if (!response.ok || identity.ownerKey !== owner) throw new Error("authenticationRequired");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<{ accounts: WebsiteAccount[] }>("desktop_automation_accounts", { owner, action, ...options });
  } catch (error) {
    if (typeof error === "string" && /desktop_automation_accounts.*not found|unknown command/i.test(error)) throw new Error("desktopUpdateRequired");
    throw new Error(typeof error === "string" && /^account[A-Za-z]+$/.test(error) ? error : "accountStorageFailed");
  }
}
