import type { AutomationAppStore } from "./automation-app-store";

/** Request-local selection. Never mutates the directory's latest-version default. */
export function versionedAppStore<T extends AutomationAppStore>(store: T, appId: string, version: string): T {
  return new Proxy(store, { get(target, key) {
    if (key === "detail") return (id: string, selected?: string) => target.detail(id, selected ?? (id === appId ? version : undefined));
    if (key === "admitRun") return (id: string, revision: number, work: Parameters<AutomationAppStore["admitRun"]>[2], enabled = true) => target.admitRun(id, revision, work, enabled, id === appId ? version : undefined);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
