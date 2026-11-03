import * as native from "./desktop-updater";
import type { DesktopUpdateState } from "./desktop-updater";
import { isNewerStableVersion } from "./app-update";

export type UpdateAction = "check" | "download" | "install";
export const DESKTOP_UPDATE_OPEN_EVENT = "eureka:desktop-update-open";
export interface UpdateView {
  host: boolean;
  state: DesktopUpdateState | null;
  loading: boolean;
  pending: UpdateAction | null;
  error: string | null;
  failedAction: UpdateAction | null;
}
type Api = Pick<typeof native, "isDesktopUpdaterHost" | "getDesktopUpdateState" | "checkDesktopUpdate" | "downloadDesktopUpdate" | "installDesktopUpdate" | "subscribeDesktopUpdate">;
const INITIAL: UpdateView = { host: false, state: null, loading: false, pending: null, error: null, failedAction: null };
export const updateBusy = (view: UpdateView) => view.loading || Boolean(view.pending) || ["checking", "downloading", "installing"].includes(view.state?.phase ?? "");
export const hasDesktopUpdate = (view: UpdateView) => Boolean(view.host && view.state?.enabled && view.state.version && isNewerStableVersion(view.state.version, view.state.currentVersion));

export function updateErrorKey(error: string) {
  if (/正在运行|结束任务|tasks?.*still running/i.test(error)) return "updates.errorTasks";
  if (/verify.*local tasks|local update preparation|local.*preparation response/i.test(error)) return "updates.errorLocalService";
  if (/signature|pubkey|public key|base64|签名/i.test(error)) return "updates.errorSignature";
  if (/command.*not found|unknown command|not allowed|bundled.*view/i.test(error)) return "updates.errorUnavailable";
  if (/development|开发版本/i.test(error)) return "updates.disabled";
  if (/operation.*running|already running/i.test(error)) return "updates.errorBusy";
  return "updates.errorRetry";
}

// One renderer-level store survives dialog closing, responsive navigation remounts
// and subsequent prompts. Native state remains authoritative after page reload.
export class DesktopUpdateController {
  private value = INITIAL;
  private listeners = new Set<() => void>();
  private generation = 0;
  private revision = 0;
  private connections = 0;
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private autoChecked = false;
  private checkRequested = false;
  constructor(private api: Api = native, private autoDelay = 10_000) {}
  getSnapshot = () => this.value;
  getServerSnapshot = () => INITIAL;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<UpdateView>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(listener => listener()); }
  private accept(state: DesktopUpdateState) {
    this.revision++;
    this.set({ state, error: state.error, ...(state.phase !== "error" ? { failedAction: null } : {}) });
  }
  connect = () => {
    this.connections++;
    if (this.connections === 1) void this.initialize();
    return () => {
      if (--this.connections !== 0) return;
      this.generation++;
      this.stop?.(); this.stop = undefined;
      clearTimeout(this.timer);
    };
  };
  private async initialize() {
    const generation = ++this.generation;
    if (!this.api.isDesktopUpdaterHost()) return;
    this.set({ host: true, loading: true });
    try {
      // Subscribe first so a slow snapshot cannot erase a newer progress event.
      const stop = await this.api.subscribeDesktopUpdate(state => { if (generation === this.generation) this.accept(state); });
      if (generation !== this.generation) { stop(); return; }
      this.stop = stop;
      const revision = this.revision;
      const state = await this.api.getDesktopUpdateState();
      if (generation !== this.generation) return;
      if (revision === this.revision) this.accept(state);
      const latest = this.value.state;
      if (!this.autoChecked && latest?.enabled && ["idle", "upToDate"].includes(latest.phase)) {
        this.timer = setTimeout(() => {
          if (generation !== this.generation || updateBusy(this.value) || this.value.state?.readyToInstall) return;
          this.autoChecked = true;
          void this.run("check");
        }, this.autoDelay);
      }
    } catch (error) {
      if (generation === this.generation) this.set({ error: String(error), failedAction: "check" });
    } finally {
      if (generation === this.generation) {
        this.set({ loading: false });
        if (this.checkRequested) { this.checkRequested = false; this.requestCheck(); }
      }
    }
  }
  requestCheck = () => {
    if (this.value.loading) { this.checkRequested = true; return; }
    // A menu check must not discard an already verified download.
    if (!this.value.state?.readyToInstall) void this.run("check");
  };
  // Each click performs one action; completing a download never starts installation.
  runPrimary = async () => {
    if (!hasDesktopUpdate(this.value) || updateBusy(this.value)) return;
    await this.run(this.value.state?.readyToInstall ? "install" : "download");
  };
  run = async (action: UpdateAction) => {
    if (!this.value.host || updateBusy(this.value) || this.value.state?.enabled === false) return;
    const version = this.value.state?.version;
    if (action !== "check" && !version) return;
    if (action === "install" && !this.value.state?.readyToInstall) return;
    // An explicit check replaces the startup check, preventing a second request.
    clearTimeout(this.timer);
    this.autoChecked = true;
    this.set({ pending: action, error: null, failedAction: null });
    const revision = this.revision;
    try {
      const state = await (action === "check" ? this.api.checkDesktopUpdate() : action === "download" ? this.api.downloadDesktopUpdate(version!) : this.api.installDesktopUpdate(version!));
      if (revision === this.revision) this.accept(state);
    } catch (error) {
      this.set({ error: String(error), failedAction: action });
    } finally { this.set({ pending: null }); }
  };
}

export const desktopUpdateController = new DesktopUpdateController();
