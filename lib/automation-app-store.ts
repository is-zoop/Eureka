import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { isAppId, isAppVersion, type AutomationAppInstall, type AutomationAppData, type AutomationAppDetail, type AutomationAppSummary, type ManagedAutomationPlugin } from "./automation-app";
import { parseManagedAutomationSource,managedAutomationState } from "./automation-managed-source";
import { AutomationAppError, automationPublishPath, inspectAutomationFiles, MAX_APP_EXPANDED, type AutomationAppPackage, writeAutomationAppZip } from "./automation-app-package";
import { assertAppIdle } from "./automation-app-lease";
import { compareAppVersions, latestAppVersion } from "./automation-app-version";
import { copyAutomationAppPackage } from "./automation-app-metadata";
import { APP_ICON_MAX, parseAppEditValues, parseAppPresentation, readAppEditIcon } from "./automation-app-presentation";

interface Registry { schemaVersion: 1; nextRevision: number; apps: AutomationAppInstall[] }
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
function fail(message: string, status = 409): never { throw new AutomationAppError(message, status); }
function parseInstall(raw: unknown): AutomationAppInstall {
  const v = raw as AutomationAppInstall | null;
  if (!v || !isAppId(v.id) || typeof v.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v.name) || typeof v.displayName !== "string" || v.displayName.length > 100 || !isAppVersion(v.activeVersion) || typeof v.disabled !== "boolean" || !Number.isSafeInteger(v.revision) || v.revision < 1 || typeof v.installedAt !== "string" || !Number.isFinite(Date.parse(v.installedAt)) || typeof v.updatedAt !== "string" || !Number.isFinite(Date.parse(v.updatedAt)) || !Array.isArray(v.versions) || !v.versions.length || v.versions.length > 32) fail("应用登记文件损坏，请恢复登记文件后重试");
  const versions = v.versions.map(item => { if (!item || !isAppVersion(item.version) || typeof item.digest !== "string" || !/^[a-f0-9]{64}$/.test(item.digest) || typeof item.installedAt !== "string" || !Number.isFinite(Date.parse(item.installedAt))) fail("应用版本登记损坏"); return { version: item.version, digest: item.digest, installedAt: item.installedAt }; });
  if (!versions.some(item => item.version === v.activeVersion) || new Set(versions.map(item => item.version)).size !== versions.length) fail("应用版本登记冲突");
  return { id: v.id, name: v.name, displayName: v.displayName, activeVersion: v.activeVersion, disabled: v.disabled, revision: v.revision, installedAt: v.installedAt, updatedAt: v.updatedAt, versions,...(v.managedPlugin?{managedPlugin:parseManagedAutomationSource(v.managedPlugin)}:{}), ...(v.presentation ? { presentation: parseAppPresentation(v.presentation) } : {}) };
}

/** Owner-scoped registration and private data; immutable packages live under plugins/. */
export class AutomationAppStore {
  readonly base: string;
  readonly codeRoot: string;
  readonly dataRoot: string;
  readonly registryDirectory: string;
  readonly registryFile: string;
  constructor(base: string, private owner: string, private assertIdentity: () => void, private options: { compactWorkspace?: boolean } = {}) {
    if (!/^[a-f0-9]{64}$/.test(owner)) fail("当前用户身份无效", 401);
    this.base = resolve(base);
    this.codeRoot = join(this.base, "plugins", "automation", owner);
    this.dataRoot = join(this.base, "app-data", owner);
    this.registryDirectory = join(this.dataRoot, "automation");
    this.registryFile = join(this.registryDirectory, "registry.json");
  }
  dataDirectory(id: string) { if (!isAppId(id)) fail("应用 ID 无效", 400); return join(this.dataRoot, id); }
  workspaceDirectory(id: string) {
    const legacy = join(this.dataDirectory(id), "workspace");
    // Creation's base is already inside the user's task directory. Avoid repeating
    // that identity hierarchy; keep distinct owners isolated even with a shared base.
    return this.options.compactWorkspace ? join(this.base, "work", createHash("sha256").update(this.owner + ":" + id).digest("hex").slice(0, 32)) : legacy;
  }
  codeDirectory(id: string, version: string) { if (!isAppId(id) || !isAppVersion(version)) fail("应用版本无效", 400); return join(this.codeRoot, id, version); }
  /** Every managed path component is checked, including before recursive removal. */
  private async checkPath(path: string) {
    const part = relative(this.base, resolve(path));
    if (!part || part === ".." || part.startsWith(`..${sep}`) || resolve(path) === this.base || /^[A-Za-z]:/.test(part)) fail("应用存储路径越界");
    let current = this.base;
    for (const name of ["", ...part.split(sep)]) {
      if (name) current = join(current, name);
      try { const stat = await lstat(current); if (stat.isSymbolicLink()) fail("应用存储中不允许链接或目录联接"); }
      catch (e) { if (missing(e)) return; throw e; }
    }
  }
  private async directory(path: string) { await this.checkPath(path); await mkdir(path, { recursive: true, mode: 0o700 }); await this.checkPath(path); if (!(await lstat(path)).isDirectory()) fail("应用存储目录无效"); }
  private async bytes(path: string, max: number) { await this.checkPath(path); const stat = await lstat(path); if (!stat.isFile() || stat.size > max) fail("应用文件过大或不是普通文件"); return readFile(path); }
  private async remove(path: string) { await this.checkPath(path); await rm(path, { recursive: true, force: true }); }
  private async writeJson(path: string, value: unknown, compact = false) {
    await this.directory(dirname(path)); await this.checkPath(path); const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, `${JSON.stringify(value, null, compact ? undefined : 2)}\n`, { flag: "wx", mode: 0o600 }); this.assertIdentity(); await rename(temp, path); }
    finally { await this.remove(temp); }
  }
  private async registry(): Promise<Registry> {
    try {
      const value = JSON.parse((await this.bytes(this.registryFile, 4 * 1024 * 1024)).toString("utf8"));
      if (value.schemaVersion !== 1 || !Array.isArray(value.apps) || value.apps.length > 100) fail("应用登记文件损坏");
      const apps = value.apps.map(parseInstall) as AutomationAppInstall[];
      if (new Set(apps.map(item => item.id)).size !== apps.length) fail("应用登记 ID 重复");
      const floor = Math.max(0, ...apps.map(item => item.revision)), nextRevision = value.nextRevision ?? floor + 1;
      if (!Number.isSafeInteger(nextRevision) || nextRevision <= floor) fail("应用登记修订号损坏");
      return { schemaVersion: 1, nextRevision, apps };
    } catch (e) { if (missing(e)) return { schemaVersion: 1, nextRevision: 1, apps: [] }; throw e; }
  }
  private async locked<T>(work: (registry: Registry) => Promise<T>, save = true): Promise<T> {
    this.assertIdentity(); await this.directory(this.registryDirectory); await this.checkPath(this.registryFile);
    const unlock = await lockfile.lock(this.registryFile, { realpath: false, retries: { retries: 8, minTimeout: 30, maxTimeout: 150 } });
    try { this.assertIdentity(); const registry = await this.registry(), result = await work(registry); this.assertIdentity(); if (save) await this.writeJson(this.registryFile, registry); return result; }
    finally { await unlock(); }
  }
  private current(registry: Registry, id: string, revision: number) {
    const install = registry.apps.find(item => item.id === id);
    if (!install || install.revision !== revision) fail("应用已变化，请刷新后重试");
    return install;
  }
  private nextRevision(registry: Registry) {
    if (registry.nextRevision >= Number.MAX_SAFE_INTEGER) fail("应用登记修订号已达上限");
    return registry.nextRevision++;
  }
  async list(): Promise<{ apps: AutomationAppSummary[]; data: AutomationAppData[] }> {
    this.assertIdentity(); const registry = await this.registry(), data: AutomationAppData[] = [];
    await this.checkPath(join(this.dataRoot, "scan"));
    let entries: string[] = []; try { entries = await readdir(this.dataRoot); } catch (e) { if (!missing(e)) throw e; }
    for (const id of entries.filter(isAppId)) {
      try {
        const saved = JSON.parse((await this.bytes(join(this.dataDirectory(id), "application.json"), 8192)).toString("utf8"));
        if (saved.schemaVersion === 1 && saved.appId === id && typeof saved.displayName === "string") data.push({ id, displayName: saved.displayName.slice(0, 100), installed: registry.apps.some(item => item.id === id) });
      } catch { /* A damaged data marker never executes or discloses another directory. */ }
    }
    this.assertIdentity(); return { apps: registry.apps.map(app => ({ ...app, ...(app.presentation ? { description: app.presentation.description } : {}) })), data };
  }
  async find(id: string) { this.assertIdentity(); const install = (await this.registry()).apps.find(item => item.id === id); this.assertIdentity(); return install ?? null; }
  /** Migrate a former version selection; already-running jobs keep their code snapshot. */
  async useLatest() {
    await this.locked(async registry => {
      let changed = false;
      for (const install of registry.apps) {
        if(install.managedPlugin)continue; // The installed plugin sources select their effective version.
        const latest = latestAppVersion(install.versions);
        if (install.activeVersion === latest && !install.disabled) continue;
        const pkg = await this.verified(install, latest);
        install.activeVersion = latest; install.disabled = false; if (!install.presentation) install.displayName = pkg.manifest.displayName; install.revision = this.nextRevision(registry); install.updatedAt = new Date().toISOString(); changed = true;
      }
      if (changed) await this.writeJson(this.registryFile, registry);
    }, false);
  }
  private async packageAt(root: string): Promise<AutomationAppPackage> {
    const manifest = JSON.parse((await this.bytes(join(root, "plugin.json"), 1024 * 1024)).toString("utf8"));
    const published: unknown = manifest.extensions?.["com.eureka"]?.automation?.files;
    if (!Array.isArray(published) || published.length > 256) fail("应用发布清单已损坏，请重新导入");
    const files = new Map<string, Buffer>(); let size = 0;
    for (const raw of published) { const name = automationPublishPath(raw), bytes = await this.bytes(join(root, ...name.split("/")), MAX_APP_EXPANDED); size += bytes.length; if (size > MAX_APP_EXPANDED) fail("应用文件总大小超限"); files.set(name, bytes); }
    return inspectAutomationFiles(files);
  }
  private async verified(install: AutomationAppInstall, version: string) {
    const entry = install.versions.find(item => item.version === version); if (!entry) fail("未安装此版本", 404);
    const pkg = await this.packageAt(this.codeDirectory(install.id, version));
    if (pkg.digest !== entry.digest || pkg.manifest.automation.id !== install.id || pkg.manifest.name !== install.name || pkg.manifest.version !== version) fail("应用代码与登记不一致，请重新导入；不会覆盖已登记版本");
    return pkg;
  }
  async detail(id: string, version?: string): Promise<AutomationAppDetail> {
    const install = await this.find(id); if (!install) fail("应用未安装", 404);
    const chosen = version ?? install.activeVersion, pkg = await this.verified(install, chosen); this.assertIdentity();
    const manifest = install.presentation ? { ...pkg.manifest, displayName: install.displayName, description: install.presentation.description } : pkg.manifest;
    return { install, manifest, ui: pkg.ui, workflow: pkg.workflow, actions: pkg.actions, files: [...pkg.files.keys()], readme: pkg.readme, codeDirectory: this.codeDirectory(id, chosen), dataDirectory: this.dataDirectory(id), workspaceDirectory: this.workspaceDirectory(id) };
  }
  async presentationIcon(id: string) {
    const install = await this.find(id), icon = install?.presentation?.icon;
    if (!install || !icon) fail("应用图标不存在", 404);
    const bytes = await this.bytes(join(this.registryDirectory, "icons", id, icon.digest), APP_ICON_MAX);
    if (createHash("sha256").update(bytes).digest("hex") !== icon.digest) fail("应用图标摘要不一致");
    this.assertIdentity(); return { bytes, mimeType: icon.mimeType };
  }
  async editValues(id: string) {
    const detail = await this.detail(id), metadata = detail.install.presentation;
    let icon;
    if (metadata?.icon) {
      const image = await this.presentationIcon(id);
      icon = { name: `icon.${image.mimeType.split("/")[1]}`, type: image.mimeType, data: image.bytes.toString("base64") };
    }
    return { displayName: detail.manifest.displayName, description: detail.manifest.description.slice(0, 300), categoryId: metadata?.categoryId ?? null, tags: metadata?.tags ?? [], icon: icon ?? null, revision: detail.install.revision, metadataRevision: metadata?.revision };
  }
  async edit(id: string, revision: number, raw: unknown, categories: readonly number[]) {
    const values = parseAppEditValues(raw, categories);
    return this.locked(async registry => {
      const install = this.current(registry, id, revision);
      if (install.managedPlugin) fail("市场应用请先另存为我的应用再编辑", 403);
      let icon = install.presentation?.icon;
      if (values.icon === null) icon = undefined;
      else if (values.icon) {
        const image = readAppEditIcon(values.icon), file = join(this.registryDirectory, "icons", id, image.digest);
        await this.directory(dirname(file)); await this.checkPath(file);
        try { await writeFile(file, image.bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        icon = { digest: image.digest, mimeType: image.mimeType };
      }
      install.displayName = values.displayName;
      install.presentation = { revision: randomUUID(), description: values.description, categoryId: values.categoryId, tags: values.tags, ...(icon ? { icon } : {}) };
      install.revision = this.nextRevision(registry); install.updatedAt = new Date().toISOString();
      return install;
    });
  }
  /** Shared admission lock: execution and removal cannot race each other. */
  async admitRun<T>(id: string, revision: number, work: (detail: AutomationAppDetail, pkg: AutomationAppPackage) => Promise<T>, requireEnabled = true) {
    return this.locked(async registry => {
      const install = this.current(registry, id, revision); if (requireEnabled && install.disabled) fail("应用已停用，请先启用。");
      if(requireEnabled&&install.managedPlugin){const state=managedAutomationState(id,install.managedPlugin),selected=state.selected;if(!selected||state.disabled)fail("所属组织插件已停用或卸载，请在扩展中管理。");if(selected.item.version!==install.activeVersion||selected.item.plugin!.manifest.automation!.digest!==install.versions.find(version=>version.version===install.activeVersion)?.digest)fail("组织插件已更新，请刷新自动化目录后运行。");}
      if (requireEnabled && !install.managedPlugin && install.activeVersion !== latestAppVersion(install.versions)) fail("应用需要使用最新版本，请重新打开应用后再操作。");
      const pkg = await this.verified(install, install.activeVersion), directory = this.dataDirectory(id);
      await this.directory(directory); await this.checkPath(join(directory, "execution-lease.lock"));
      const marker = join(directory, "application.json"); await this.checkPath(marker);
      try { await lstat(marker); } catch (e) { if (!missing(e)) throw e; await this.writeJson(marker, { schemaVersion: 1, appId: id, displayName: pkg.manifest.displayName }); }
      return work({ install, manifest: pkg.manifest, ui: pkg.ui, workflow: pkg.workflow, actions: pkg.actions, files: [...pkg.files.keys()], readme: pkg.readme, codeDirectory: this.codeDirectory(id, install.activeVersion), dataDirectory: directory, workspaceDirectory: this.workspaceDirectory(id) }, pkg);
    }, false);
  }
  async managedPath(path: string) { await this.checkPath(path); return path; }
  async ensureDataDirectory(path: string) {
    const relativePath = relative(this.dataRoot, path); if (!relativePath || relativePath.startsWith("..") || /^[A-Za-z]:/.test(relativePath)) fail("用户数据路径无效");
    await this.directory(path);
  }
  /** Called under run admission and the application lease; never executes code. */
  async ensureWorkspace(id: string) {
    this.assertIdentity();
    const target = this.workspaceDirectory(id), legacy = join(this.dataDirectory(id), "workspace");
    if (!this.options.compactWorkspace) { await this.directory(target); return target; }
    await this.checkPath(target);
    try { if (!(await lstat(target)).isDirectory()) fail("应用工作区不是目录"); return target; }
    catch (e) { if (!missing(e)) throw e; }
    await this.checkPath(legacy);
    let exists = false;
    try { if (!(await lstat(legacy)).isDirectory()) fail("原应用工作区不是目录"); exists = true; }
    catch (e) { if (!missing(e)) throw e; }
    const staging = join(dirname(target), `.workspace-${randomUUID()}`);
    await this.directory(staging);
    try {
      const copy = async (source: string, destination: string): Promise<void> => {
        this.assertIdentity(); await this.checkPath(source); await this.checkPath(destination);
        const info = await lstat(source);
        if (info.isDirectory()) {
          await this.directory(destination);
          for (const name of await readdir(source)) await copy(join(source, name), join(destination, name));
        } else if (info.isFile()) await copyFile(source, destination, constants.COPYFILE_EXCL);
        else fail("原应用工作区含不支持的文件，未迁移");
      };
      if (exists) await copy(legacy, staging);
      this.assertIdentity(); await this.checkPath(target); await rename(staging, target);
    } finally { await this.remove(staging); }
    // Retain legacy data as a recovery copy. Registry, grants and evidence stay put.
    return target;
  }
  async privateJson(path: string, value: unknown) { await this.writeJson(path, value, true); }
  async privateBytes(path: string, limit: number) { return this.bytes(path, limit); }
  async install(pkg: AutomationAppPackage, expectedRevision: number, managed?:{source:ManagedAutomationPlugin;disabled:boolean}): Promise<AutomationAppInstall> {
    return this.locked(async registry => {
      const { manifest } = pkg, id = manifest.automation.id, old = registry.apps.find(item => item.id === id);
      if(old?.managedPlugin&&(!managed||old.managedPlugin.source!==managed.source.source||old.managedPlugin.capabilityId!==managed.source.capabilityId))fail("此应用由组织插件管理，请使用现有插件更新入口。");
      if(managed){const state=managedAutomationState(id,managed.source);if(old&&!old.managedPlugin)fail("本机已有同 ID 的个人应用，请先卸载个人应用（保留数据）再安装组织插件。");if(!state.selected||state.selected.item.version!==manifest.version||state.selected.item.plugin!.manifest.automation!.digest!==pkg.digest||state.disabled!==managed.disabled)fail("组织插件登记已变化，请重新安装或刷新。");}
      if ((old?.revision ?? 0) !== expectedRevision || (old && old.name !== manifest.name)) fail("安装状态或应用身份已变化，请重新选择应用包");
      if (old && !managed && compareAppVersions(manifest.version, latestAppVersion(old.versions)) < 0) fail("仅支持最新版本或更高版本，不能安装较旧的应用包");
      if (!old && registry.apps.length >= 100) fail("本机应用登记已满");
      const previous = old?.versions.find(item => item.version === manifest.version);
      if (previous && previous.digest !== pkg.digest) fail("相同版本的代码不同，请增加版本号后重新导入");
      if (!previous && old && old.versions.length >= 32) fail("此应用保留版本已满");
      const parent = join(this.codeRoot, id), target = this.codeDirectory(id, manifest.version), staging = join(parent, `.install-${randomUUID()}`);
      await this.directory(parent); await this.checkPath(target);
      let exists = true; try { await lstat(target); } catch (e) { if (missing(e)) exists = false; else throw e; }
      if (exists) { const actual = await this.packageAt(target); if (actual.digest !== pkg.digest) fail("该版本目录已有不同代码，不能覆盖"); }
      else {
        await this.directory(staging);
        try {
          for (const [name, bytes] of pkg.files) { this.assertIdentity(); const file = join(staging, ...name.split("/")); await this.directory(dirname(file)); await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
          this.assertIdentity(); await rename(staging, target);
        } finally { await this.remove(staging); }
      }
      // Never copy creation evidence, configuration, login state or real samples into code.
      const data = this.dataDirectory(id); await this.directory(data);
      await this.writeJson(join(data, "application.json"), { schemaVersion: 1, appId: id, displayName: manifest.displayName });
      const config = join(data, "config.json"); await this.checkPath(config);
      try { await lstat(config); } catch (e) { if (!missing(e)) throw e; this.assertIdentity(); await writeFile(config, JSON.stringify({ schemaVersion: 1, values: {} }, null, 2), { flag: "wx", mode: 0o600 }); }
      for (const folder of ["logs", "artifacts", "evidence"]) await this.directory(join(data, folder));
      const now = new Date().toISOString();
      const install: AutomationAppInstall = { id, name: manifest.name, displayName: !managed && old?.presentation ? old.displayName : manifest.displayName, activeVersion: manifest.version, disabled: managed?.disabled ?? false, revision: this.nextRevision(registry), installedAt: old?.installedAt ?? now, updatedAt: now, versions: previous ? old!.versions : [...(old?.versions ?? []), { version: manifest.version, digest: pkg.digest, installedAt: now }],...(managed?{managedPlugin:parseManagedAutomationSource(managed.source)}:{}), ...(!managed && old?.presentation ? { presentation: old.presentation } : {}) };
      registry.apps = [install, ...registry.apps.filter(item => item.id !== id)]; return install;
    });
  }
  async saveAs(id: string, revision: number, targetId: unknown, displayName: unknown): Promise<AutomationAppInstall> {
    const pkg = await this.locked(async registry => {
      const source = this.current(registry, id, revision);
      if (source.managedPlugin) {
        const selected = managedAutomationState(id, source.managedPlugin).selected;
        if (!selected || selected.item.version !== source.activeVersion || selected.item.plugin!.manifest.automation!.digest !== source.versions.find(version => version.version === source.activeVersion)?.digest) fail("来源插件已变化，请刷新应用目录后另存。");
      }
      return copyAutomationAppPackage(await this.verified(source, source.activeVersion), targetId, displayName);
    }, false);
    const reuse = async () => {
      const existing = await this.find(pkg.manifest.automation.id);
      if (!existing) return null;
      if (existing.managedPlugin || existing.name !== pkg.manifest.name || !existing.versions.some(version => version.version === pkg.manifest.version && version.digest === pkg.digest)) fail("另存目标已存在，请重新打开另存窗口。");
      await this.verified(existing, pkg.manifest.version); return existing;
    };
    const existing = await reuse(); if (existing) return existing;
    try { return await this.install(pkg, 0); }
    catch (error) { const completed = await reuse(); if (completed) return completed; throw error; }
  }
  async change(id: string, revision: number, action: "enable" | "disable") {
    return this.locked(async registry => {
      const install = this.current(registry, id, revision);
      if(install.managedPlugin)fail("此应用由组织插件管理，请在扩展中启用或停用插件。");
      if (action !== "enable" && action !== "disable") fail("仅支持使用最新版本，版本切换已移除", 400);
      install.disabled = action === "disable";
      install.revision = this.nextRevision(registry); install.updatedAt = new Date().toISOString(); return install;
    });
  }
  async uninstall(id: string, revision: number, managed?:ManagedAutomationPlugin, deleteData = false) {
    return this.locked(async registry => {
      await assertAppIdle(this.dataDirectory(id));
      const install=this.current(registry, id, revision);if(install.managedPlugin&&(!managed||managed.source!==install.managedPlugin.source||managed.capabilityId!==install.managedPlugin.capabilityId))fail("此应用由组织插件管理，请在扩展中卸载插件。");const root = join(this.codeRoot, id), trash = join(this.codeRoot, `.removed-${id}-${randomUUID()}`);
      await this.checkPath(root); await this.checkPath(trash); this.assertIdentity();
      let moved = false;
      try { await rename(root, trash); moved = true; } catch (e) { if (!missing(e)) throw e; }
      // Commit registration before deleting code. A failed commit restores the original path.
      const apps = registry.apps; registry.apps = apps.filter(item => item.id !== id);
      try { await this.writeJson(this.registryFile, registry); }
      catch (e) { registry.apps = apps; if (moved) await rename(trash, root); throw e; }
      const warnings: string[] = [];
      if (moved) { try { await this.remove(trash); } catch { warnings.push("部分代码文件被占用，临时目录尚未清理。"); } }
      let dataRetained = true;
      if (deleteData) {
        try {
          this.assertIdentity(); await this.remove(this.dataDirectory(id));
          if (this.options.compactWorkspace) await this.remove(this.workspaceDirectory(id));
          dataRetained = false;
        } catch { warnings.push("用户数据未完全删除，请在自动化管理中重试清理。"); }
      }
      return { ok: true, dataRetained, ...(warnings.length ? { warning: `已卸载；${warnings.join("")}` } : {}) };
    }, false);
  }
  async clearData(id: string, revision: number) {
    return this.locked(async registry => {
      await assertAppIdle(this.dataDirectory(id));
      const install = registry.apps.find(item => item.id === id);
      if ((install?.revision ?? 0) !== revision) fail("应用已变化，请刷新后重试");
      const path = this.dataDirectory(id); this.assertIdentity(); await this.remove(path);
      if (this.options.compactWorkspace) await this.remove(this.workspaceDirectory(id));
      if (install) { install.revision = this.nextRevision(registry); install.updatedAt = new Date().toISOString(); }
      return { ok: true };
    });
  }
  async export(id: string, version?: string) {
    const install = await this.find(id); if (!install) fail("应用未安装", 404);
    if (install.managedPlugin) fail("市场应用不能直接导出，请先另存为我的应用。", 403);
    const pkg = await this.verified(install, version ?? install.activeVersion); this.assertIdentity();
    // packageAt reads exactly the publish list. No filesystem recursion or data-root reads.
    return { bytes: writeAutomationAppZip(pkg.files), filename: `${pkg.manifest.name}-${pkg.manifest.version}.zip` };
  }
}
