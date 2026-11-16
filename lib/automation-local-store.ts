import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { AutomationAppStore } from "./automation-app-store";
import { AutomationAppError, type AutomationAppPackage } from "./automation-app-package";
import { isAppId, type AutomationAppDetail, type AutomationAppInstall, type ManagedAutomationPlugin } from "./automation-app";
import { localAutomationNamespaces, localAutomationPath, readLocalAutomationJson } from "./automation-local-context";

/** One local catalog over existing namespaces. Original files stay in place. */
export class LocalAutomationAppStore extends AutomationAppStore {
  private stores = new Map<string, AutomationAppStore>();
  private namespaces: Map<string, Set<string>> | null = null;
  constructor(base: string, private localOwner: string, private check: () => void) { super(base, localOwner, check); }
  private owners() { return [...new Set([this.localOwner, ...localAutomationNamespaces(this.base)])]; }
  private child(owner: string): AutomationAppStore {
    if (owner === this.localOwner) return this;
    let store = this.stores.get(owner);
    if (!store) { store = new AutomationAppStore(this.base, owner, this.check); this.stores.set(owner, store); }
    return store;
  }
  private catalog() {
    if (this.namespaces) return this.namespaces;
    const map = new Map<string, Set<string>>();
    const add = (id: string, owner: string) => { if (!isAppId(id)) throw new AutomationAppError("本地应用登记 ID 无效", 409); const values = map.get(id) ?? new Set(); values.add(owner); map.set(id, values); };
    for (const owner of this.owners()) {
      const root = localAutomationPath(this.base, join(this.base, "app-data", owner));
      try {
        const registry = readLocalAutomationJson(this.base, join(root, "automation", "registry.json")) as { schemaVersion: number; apps: AutomationAppInstall[] };
        if (registry.schemaVersion !== 1 || !Array.isArray(registry.apps) || registry.apps.length > 100) throw new AutomationAppError("本地应用登记损坏", 409);
        for (const app of registry.apps) add(app.id, owner);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      try { for (const entry of readdirSync(root, { withFileTypes: true })) if (isAppId(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()) add(entry.name, owner); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    this.namespaces = map;
    return map;
  }
  private forApp(id: string): AutomationAppStore {
    const owners = this.catalog().get(id);
    if (owners && owners.size > 1) throw new AutomationAppError("不同旧目录存在同 ID 应用，原数据均已保留，请先处理目录冲突", 409);
    return this.child(owners?.values().next().value ?? this.localOwner);
  }
  override dataDirectory(id: string): string { const store = this.forApp(id); return store === this ? super.dataDirectory(id) : store.dataDirectory(id); }
  override workspaceDirectory(id: string): string { const store = this.forApp(id); return store === this ? super.workspaceDirectory(id) : store.workspaceDirectory(id); }
  override codeDirectory(id: string, version: string, revision?: string): string { const store = this.forApp(id); return store === this ? super.codeDirectory(id, version, revision) : store.codeDirectory(id, version, revision); }
  override async list() {
    const apps = new Map<string, Awaited<ReturnType<AutomationAppStore["list"]>>["apps"][number]>(), data = new Map<string, Awaited<ReturnType<AutomationAppStore["list"]>>["data"][number]>();
    for (const owner of this.owners()) {
      const store = this.child(owner), result = store === this ? await super.list() : await store.list();
      for (const app of result.apps) apps.set(app.id, apps.has(app.id) ? { ...app, error: "旧目录存在同 ID 应用，原数据均已保留" } : app);
      for (const item of result.data) data.set(item.id, { ...item, installed: item.installed || data.get(item.id)?.installed === true });
    }
    return { apps: [...apps.values()], data: [...data.values()] };
  }
  override async useLatest() { for (const owner of this.owners()) { const store = this.child(owner); if (store === this) await super.useLatest(); else await store.useLatest(); } }
  override async find(id: string): Promise<AutomationAppInstall | null> { const store = this.forApp(id); return store === this ? super.find(id) : store.find(id); }
  override async detail(id: string, version?: string): ReturnType<AutomationAppStore["detail"]> { const store = this.forApp(id); return store === this ? super.detail(id, version) : store.detail(id, version); }
  override async presentationIcon(id: string): ReturnType<AutomationAppStore["presentationIcon"]> { const store = this.forApp(id); return store === this ? super.presentationIcon(id) : store.presentationIcon(id); }
  override async editValues(id: string): ReturnType<AutomationAppStore["editValues"]> { const store = this.forApp(id); return store === this ? super.editValues(id) : store.editValues(id); }
  override async edit(...args: Parameters<AutomationAppStore["edit"]>): ReturnType<AutomationAppStore["edit"]> { const store = this.forApp(args[0]); return store === this ? super.edit(...args) : store.edit(...args); }
  override async admitRun<T>(id: string, revision: number, work: (detail: AutomationAppDetail, pkg: AutomationAppPackage) => Promise<T>, enabled = true, version?: string): Promise<T> { const store = this.forApp(id); return store === this ? super.admitRun(id, revision, work, enabled, version) : store.admitRun(id, revision, work, enabled, version); }
  override async ensureWorkspace(id: string): ReturnType<AutomationAppStore["ensureWorkspace"]> { const store = this.forApp(id); return store === this ? super.ensureWorkspace(id) : store.ensureWorkspace(id); }
  override async ensureDataDirectory(path: string) {
    const owner = relative(join(this.base, "app-data"), path).split(sep)[0];
    if (owner !== this.localOwner && this.owners().includes(owner)) return this.child(owner).ensureDataDirectory(path);
    return super.ensureDataDirectory(path);
  }
  override async install(pkg: AutomationAppPackage, revision: number, managed?: { source: ManagedAutomationPlugin; disabled: boolean }, localRevision = false): ReturnType<AutomationAppStore["install"]> {
    const store = this.forApp(pkg.manifest.automation.id), result = store === this ? await super.install(pkg, revision, managed, localRevision) : await store.install(pkg, revision, managed, localRevision);
    this.namespaces = null; return result;
  }
  override async saveAs(...args: Parameters<AutomationAppStore["saveAs"]>): ReturnType<AutomationAppStore["saveAs"]> { const store = this.forApp(args[0]), result = store === this ? await super.saveAs(...args) : await store.saveAs(...args); this.namespaces = null; return result; }
  override async change(...args: Parameters<AutomationAppStore["change"]>): ReturnType<AutomationAppStore["change"]> { const store = this.forApp(args[0]); return store === this ? super.change(...args) : store.change(...args); }
  override async uninstall(...args: Parameters<AutomationAppStore["uninstall"]>): ReturnType<AutomationAppStore["uninstall"]> { const store = this.forApp(args[0]), result = store === this ? await super.uninstall(...args) : await store.uninstall(...args); this.namespaces = null; return result; }
  override async clearData(...args: Parameters<AutomationAppStore["clearData"]>): ReturnType<AutomationAppStore["clearData"]> { const store = this.forApp(args[0]); return store === this ? super.clearData(...args) : store.clearData(...args); }
  override async export(id: string, version?: string): ReturnType<AutomationAppStore["export"]> { const store = this.forApp(id); return store === this ? super.export(id, version) : store.export(id, version); }
}
