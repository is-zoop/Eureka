import type { AutomationAppSummary } from "./automation-app";

export type AutomationAppUsage = Record<string, { opens: number; lastOpenedAt: number }>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const keyFor = (ownerKey: string) => `eureka:automation-app-usage:${ownerKey}`;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readAutomationAppUsage(ownerKey: string, storage: StorageLike | null = browserStorage()): AutomationAppUsage {
  if (!ownerKey || !storage) return {};
  try {
    const value: unknown = JSON.parse(storage.getItem(keyFor(ownerKey)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, AutomationAppUsage[string]] => {
      const usage = entry[1];
      return Boolean(usage && typeof usage === "object" && Number.isSafeInteger(usage.opens) && usage.opens > 0 && Number.isFinite(usage.lastOpenedAt) && usage.lastOpenedAt >= 0);
    }).sort((a, b) => b[1].lastOpenedAt - a[1].lastOpenedAt).slice(0, 200));
  } catch { return {}; }
}

/** An explicit visit counts as use; listing, refreshing and running-state polling do not. */
export function recordAutomationAppOpen(ownerKey: string, appId: string, now = Date.now(), storage: StorageLike | null = browserStorage()): AutomationAppUsage {
  const usage = readAutomationAppUsage(ownerKey, storage);
  if (!ownerKey || !appId) return usage;
  const next = { ...usage, [appId]: { opens: Math.min((usage[appId]?.opens ?? 0) + 1, Number.MAX_SAFE_INTEGER), lastOpenedAt: now } };
  try { storage?.setItem(keyFor(ownerKey), JSON.stringify(next)); } catch { /* Keep the current page usable when storage is full or blocked. */ }
  return next;
}

export function getFrequentAutomationApps(apps: readonly AutomationAppSummary[], usage: AutomationAppUsage): AutomationAppSummary[] {
  return apps.filter(app => !app.disabled && !app.error).sort((a, b) =>
    (usage[b.id]?.opens ?? 0) - (usage[a.id]?.opens ?? 0)
    || (usage[b.id]?.lastOpenedAt ?? 0) - (usage[a.id]?.lastOpenedAt ?? 0),
  ).slice(0, 3);
}
