"use client";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeftIcon, ArrowRightIcon, RefreshCwIcon, XIcon, GlobeIcon, MinusIcon, PlusIcon, ChevronDownIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { LabelTooltip } from "./LabelTooltip";
import { browserSlotBounds, browserOverlay, nativeBrowserCommand, nativeBrowserObservation, nativeBrowserControl, nativeBrowserApplication, sameNativeBrowser, type NativeBrowserSpec, type NativeBrowserSnapshot } from "@/lib/native-browser";
import { parsePageObservation } from "@/lib/automation-observation";
import { automationBrowserError, type AutomationBrowserControls, type AutomationTaskState } from "@/lib/automation-task-state";
import { useI18n } from "@/hooks/useI18n";

const ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

export function NativeBrowserPanel({ spec, visible, onHide, onClose, controlRef, onTaskState }: { spec: NativeBrowserSpec; visible: boolean; onHide: () => void; onClose: () => void; controlRef?: Ref<AutomationBrowserControls>; onTaskState?: (state: AutomationTaskState) => void }) {
  const { t } = useI18n();
  const slot = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const opened = useRef(false);
  const authorized = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [snapshot, setSnapshot] = useState<NativeBrowserSnapshot>({ opened: false, title: "网页", url: "", loading: true });
  const [address, setAddress] = useState("");
  const addressDirty = useRef(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [preferredZoom, setPreferredZoom] = useState(100);
  const preferredZoomRef = useRef(preferredZoom); preferredZoomRef.current = preferredZoom;
  const [zoomBusy, setZoomBusy] = useState(false);
  const zoomBusyRef = useRef(false);
  useEffect(() => {
    let percent = 100;
    try {
      const raw = localStorage.getItem(`eureka:browser:zoom:${spec.ownerKey}`);
      if (raw !== null && Number.isInteger(Number(raw)) && Number(raw) >= 25 && Number(raw) <= 200) percent = Number(raw);
      localStorage.removeItem(`eureka:browser:page-width:${spec.ownerKey}`);
    } catch {}
    setPreferredZoom(percent);
  }, [spec.ownerKey]);
  const halted = useRef(false);
  const generation = useRef(0);
  const stopping = useRef<Promise<void> | null>(null);
  const closedConfirmed = useRef(false);
  const controlToken = useRef<string | null>(null);
  // A refreshed document must issue newer control intents than the previous
  // document; the native view and its sequence survive a frontend reload.
  const controlSequence = useRef(Date.now()*1000);
  const pausePending = useRef<Promise<void> | null>(null);
  const [controlled, setControlled] = useState(false);
  const pauseAutomation = useCallback(() => {
    if (pausePending.current) return pausePending.current;
    const token = controlToken.current;
    if (!token) return Promise.resolve();
    controlToken.current = null;
    const task = (async () => {
      try { await nativeBrowserControl(spec, "pause", token, ++controlSequence.current); }
      catch (error) { if (error !== "browserClosed") throw new Error("pauseFailed"); }
      finally { pausePending.current = null; if (alive.current) setControlled(false); }
    })();
    pausePending.current = task;
    return task;
  }, [spec]);
  const [stopPhase, setStopPhase] = useState<"stopping" | "stopped" | null>(null);
  const phase = stopPhase ?? (error ? "error" : !snapshot.opened ? "opening" : snapshot.loading ? "loading" : "manual");
  useEffect(() => { onTaskState?.({ phase, ...(error ? { message: error } : {}) }); }, [phase, error, onTaskState]);

  const stop = useCallback(() => {
    if (stopping.current) return stopping.current;
    halted.current = true; authorized.current = false; generation.current++;
    closedConfirmed.current = false;
    setStopPhase("stopping"); setError("");
    void pauseAutomation().catch(() => {});
    const task = (async () => {
      try {
        await nativeBrowserCommand(spec, "close");
        if (!alive.current) return;
        opened.current = false;
        closedConfirmed.current = true;
        setSnapshot({ opened: false, title: "网页", url: "", loading: false });
        setStopPhase("stopped");
      } catch {
        if (alive.current) { setStopPhase(null); setError("尚未确认网站已关闭。请重试停止；仍失败时退出桌面测试程序。"); }
      } finally { stopping.current = null; }
    })();
    stopping.current = task;
    return task;
  }, [spec, pauseAutomation]);
  const restart = useCallback(() => {
    if (stopping.current) return;
    generation.current++; halted.current = false; opened.current = false;
    setStopPhase(null); setError("");
    setSnapshot({ opened: false, title: "网页", url: "", loading: true });
    setRetry(n => n + 1);
  }, []);
  const readObservation = useCallback(async (options: { screenshot?: boolean; expectedId?: string }) => {
    if (halted.current || !opened.current || !authorized.current || !visibleRef.current) throw new Error("observationUnavailable");
    const run = generation.current;
    try {
      const value = await nativeBrowserObservation(spec, options);
      if (!alive.current || halted.current || !authorized.current || run !== generation.current) throw new Error("observationUnavailable");
      return value;
    } catch (error) {
      if (typeof error === "string" && /desktop_automation_observe.*not found|unknown command/i.test(error)) throw new Error("desktopUpdateRequired");
      throw new Error("observationUnavailable");
    }
  }, [spec]);
  useImperativeHandle(controlRef, () => ({ stop, restart,
    observe: async screenshot => parsePageObservation(await readObservation({ screenshot })),
    validateObservation: async id => { await readObservation({ expectedId: id }); },
    claimApplication: async () => {
      if (!spec.applicationRunId || halted.current || !opened.current || !authorized.current || !visibleRef.current || controlToken.current || pausePending.current) throw new Error("网页控制不可用");
      const token = crypto.randomUUID(); controlToken.current = token;
      try {
        const page = parsePageObservation(await readObservation({}));
        if (controlToken.current !== token || halted.current) throw new Error("网页控制已暂停");
        await nativeBrowserControl(spec, "claim", token, ++controlSequence.current, page.id);
        if (controlToken.current !== token || halted.current || !alive.current) throw new Error("网页控制已暂停");
        setControlled(true);
      } catch (e) { if (controlToken.current === token) await pauseAutomation(); throw e; }
    },
    applicationRequest: async (payload, ticket) => {
      if (!spec.applicationRunId || halted.current || !opened.current || !authorized.current || !visibleRef.current) throw new Error("网页面板不可用，未重复派发");
      const run = generation.current;
      const result = await nativeBrowserApplication(spec, controlToken.current ?? "", payload, ticket);
      if (run !== generation.current || halted.current || !alive.current) throw new Error("网页连接已变化，操作结果未知，请人工核对");
      return result;
    },
    pauseAutomation,
  }), [stop, restart, readObservation, spec, pauseAutomation]);
  const command = useCallback(async (action: string, url?: string) => {
    if (halted.current || controlToken.current) return false;
    addressDirty.current = false;
    const run = generation.current;
    if (action === "navigate") {
      try {
        const target = new URL(url!);
        if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error();
      } catch { setError("请输入完整的 HTTP/HTTPS 网页地址，不能包含用户名或密码。"); return false; }
    }
    try {
      const value = await nativeBrowserCommand(spec, action, { url });
      if (alive.current && !halted.current && run === generation.current) { setSnapshot(value); setError(""); }
      return true;
    } catch (error) {
      if (alive.current && !halted.current && run === generation.current) setError(automationBrowserError(error, "网页操作失败。请检查网站连接，尝试刷新网页；仍失败时停止并重新打开。"));
      return false;
    }
  }, [spec]);

  useEffect(() => { zoomBusyRef.current = false; setZoomBusy(false); }, [spec, retry]);
  const zoom = snapshot.opened ? snapshot.zoomPercent ?? preferredZoom : preferredZoom;
  const changeZoom = async (percent: number) => {
    if (!Number.isInteger(percent) || percent < 25 || percent > 200 || zoomBusyRef.current || controlToken.current || halted.current || !opened.current || !authorized.current || !visibleRef.current) return;
    const run = generation.current;
    zoomBusyRef.current = true; setZoomBusy(true);
    try {
      const value = await nativeBrowserCommand(spec, "zoom", { zoomPercent: percent });
      if (!alive.current || halted.current || run !== generation.current) return;
      if (!value.opened || typeof value.zoomPercent !== "number" || !Number.isFinite(value.zoomPercent) || value.zoomPercent < 25 || value.zoomPercent > 200) throw new Error("desktopUpdateRequired");
      const actual = Math.round(value.zoomPercent);
      setSnapshot(value); setPreferredZoom(actual); setError("");
      try { localStorage.setItem(`eureka:browser:zoom:${spec.ownerKey}`, String(actual)); } catch {}
    } catch (error) {
      if (alive.current && !halted.current && run === generation.current) setError(automationBrowserError(error, "网页缩放失败，请重试。"));
    } finally {
      if (alive.current && run === generation.current) { zoomBusyRef.current = false; setZoomBusy(false); }
    }
  };
  const smallerZoom = [...ZOOM_LEVELS].reverse().find(percent => percent < zoom);
  const largerZoom = ZOOM_LEVELS.find(percent => percent > zoom);
  const zoomDisabled = controlled || zoomBusy || !snapshot.opened || stopPhase !== null;

  useEffect(() => {
    if (!visible) void pauseAutomation().catch(() => {});
  }, [visible, pauseAutomation]);

  useEffect(() => {
    alive.current = true; opened.current = false; authorized.current = false;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (cancelled || halted.current) return;
      const run = generation.current;
      let identityFailed=false;
      try {
        if (!spec.sessionId.startsWith("automation:app:")) { identityFailed=true;throw new Error("retiredAutomationSession"); }
        const appId = spec.applicationId ?? spec.sessionId.slice("automation:app:".length);
        const appUrl = `/api/automation/apps/${encodeURIComponent(appId)}/browser?${new URLSearchParams({mode:"spec",runId:spec.applicationRunId??"",siteId:spec.applicationSiteId??"",...(spec.applicationTaskId?{taskId:spec.applicationTaskId}:{})})}`;
        const response = await fetch(appUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        const body = await response.json();
        if (cancelled || halted.current || run !== generation.current) return;
        if (!response.ok) { identityFailed=[401,403].includes(response.status);throw new Error("identity"); }
        if(body.ownerKey!==spec.ownerKey||!sameNativeBrowser(body.native,spec)){identityFailed=true;throw new Error("identity");}
        authorized.current = true;
        if (opened.current) {
          const value = await nativeBrowserCommand(spec, "renew");
          if (!cancelled && !halted.current && run === generation.current) {
            setSnapshot(value);
            if (!value.opened) { opened.current = false; authorized.current = false; halted.current = true; setError("网站视图已关闭或会话已过期。请重新打开网站并登录。"); }
          }
        }
      } catch {
        if (cancelled || halted.current || run !== generation.current) return;
        // A temporary host/network error may be retried without closing the
        // native page or turning the whole conversation into a cancellation.
        if(!identityFailed){timer=setTimeout(check,1500);return;}
        halted.current = true;
        authorized.current = false;
        await nativeBrowserCommand(spec, "close").catch(() => {});
        if (!cancelled && run === generation.current) { opened.current = false; setError("无法确认当前 Haze 登录或服务连接，已请求关闭网站。请检查登录和连接后重新打开。"); }
      }
      if (!cancelled && !halted.current) timer = setTimeout(check, 5000);
    };
    void check();
    return () => {
      cancelled = true; alive.current = false; authorized.current = false; generation.current++;
      clearTimeout(timer);
      void pauseAutomation().catch(() => {});
      void nativeBrowserCommand(spec, "hide").catch(() => {});
    };
  }, [spec, retry]);

  useEffect(() => { if (!addressDirty.current) setAddress(snapshot.url || spec.websiteUrl); }, [snapshot.url, spec.websiteUrl]);

  useEffect(() => {
    let cancelled = false, busy = false, failed = false, signature = "", frame = 0;
    let nextStatus = 0, retryAt = 0, layoutError = "", advertised:boolean|undefined;
    const layout = async () => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => void layout());
      if (busy || failed || halted.current || Date.now() < retryAt) return;
      const bounds = visibleRef.current && slot.current ? browserSlotBounds(slot.current) : null;
      const overlay = bounds ? browserOverlay(bounds) : undefined;
      const available=Boolean(bounds)&&!overlay?.blockInput&&authorized.current;
      if(advertised!==available){advertised=available;window.dispatchEvent(new CustomEvent("eureka:automation-browser-availability",{detail:{spec,available}}));}
      if (overlay?.blockInput && controlToken.current) void pauseAutomation().catch(() => {});
      const next = bounds ? JSON.stringify({ bounds, overlay }) : "hidden";
      if (!authorized.current) return;
      if (signature === next && (!opened.current || Date.now() < nextStatus)) return;
      busy = true;
      const run = generation.current;
      try {
        let value: NativeBrowserSnapshot | undefined;
        if (!bounds) {
          if (opened.current && signature !== next) value = await nativeBrowserCommand(spec, "hide");
        } else if (!opened.current) {
          value = await nativeBrowserCommand(spec, "open", { url: spec.websiteUrl, bounds, zoomPercent: preferredZoomRef.current, overlay });
          if (!cancelled && !halted.current && run === generation.current) opened.current = value.opened;
        } else if (signature !== next) {
          value = await nativeBrowserCommand(spec, "bounds", { bounds, overlay });
        } else value = await nativeBrowserCommand(spec, "status");
        signature = next; nextStatus = Date.now() + 1000;
        if (value && !cancelled && !halted.current && run === generation.current) {
          if (layoutError) { const previous = layoutError; setError(current => current === previous ? "" : current); layoutError = ""; }
          setSnapshot(value);
          if (opened.current && !value.opened) { opened.current = false; authorized.current = false; halted.current = true; setError("网站视图已关闭或会话已过期。请重新打开网站并登录。"); }
        }
      } catch (error) {
        // A layout/status error must not freeze a stale modal cutout forever.
        // Retry only presentation for an already opened view, never page actions.
        failed = !opened.current;
        signature = ""; retryAt = Date.now() + 1000;
        if (!cancelled && !halted.current && run === generation.current) {
          layoutError = automationBrowserError(error, "网站视图连接失败。请确认桌面测试程序仍在运行；可停止后重新打开。");
          setError(layoutError);
        }
      } finally { busy = false; }
    };
    void layout();
    return () => { cancelled = true; cancelAnimationFrame(frame); void nativeBrowserCommand(spec, "hide").catch(() => {}); };
  }, [spec, retry]);

  return <section className="browser-panel" aria-label="原生网站浏览器">
    <header className="browser-toolbar"><GlobeIcon size={16} /><strong>网站浏览器</strong><span style={{ flex: 1 }} /><LabelTooltip content={snapshot.title}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{snapshot.title}</span></LabelTooltip>
      {controlled && <button onClick={() => window.dispatchEvent(new CustomEvent("eureka:automation-pause",{detail:{taskId:spec.applicationTaskId,runId:spec.applicationRunId}}))}>{t("automation.run.pause")}</button>}
      <LabelTooltip content={t(spec.browserMode !== "temporary" ? "automation.accounts.stopHint" : "automation.stopHint")}><button aria-label="关闭网站" disabled={stopPhase === "stopping"} onClick={() => void stop().then(() => { if (closedConfirmed.current) onClose(); })}><XIcon size={16} /></button></LabelTooltip><button onClick={onHide}>隐藏面板</button>
    </header>
    <form className="browser-toolbar" onSubmit={e => { e.preventDefault(); addressDirty.current = false; void command("navigate", /^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`); }}>
      <LabelTooltip content="后退"><button type="button" aria-label="后退" disabled={controlled || !snapshot.opened || stopPhase !== null} onClick={() => void command("back")}><ArrowLeftIcon size={15} /></button></LabelTooltip>
      <LabelTooltip content="前进"><button type="button" aria-label="前进" disabled={controlled || !snapshot.opened || stopPhase !== null} onClick={() => void command("forward")}><ArrowRightIcon size={15} /></button></LabelTooltip>
      <LabelTooltip content="刷新"><button type="button" aria-label="刷新" disabled={controlled || !snapshot.opened || stopPhase !== null} onClick={() => void command("reload")}><RefreshCwIcon size={15} /></button></LabelTooltip>
      <input aria-label="网页地址" disabled={controlled || stopPhase !== null} value={address} onChange={e => { addressDirty.current = true; setAddress(e.target.value); }} onBlur={e => { if (!e.currentTarget.form?.contains(e.relatedTarget)) { addressDirty.current = false; setAddress(snapshot.url || spec.websiteUrl); } }} onKeyDown={e => { if (e.key === "Escape") { addressDirty.current = false; setAddress(snapshot.url || spec.websiteUrl); e.currentTarget.blur(); } }} /><button disabled={controlled || !snapshot.opened || stopPhase !== null || !address.trim()}>打开</button>
      <div className="browser-zoom" role="group" aria-label="网页缩放">
        <LabelTooltip content="缩小网页"><Button type="button" variant="ghost" size="sm" aria-label="缩小网页" disabled={zoomDisabled || smallerZoom === undefined} onClick={() => { if (smallerZoom !== undefined) void changeZoom(smallerZoom); }}><MinusIcon size={14} /></Button></LabelTooltip>
        <DropdownMenu>
          <LabelTooltip content="选择缩放比例，100% 恢复原始大小"><DropdownMenuTrigger disabled={zoomDisabled} aria-label={`网页缩放 ${zoom}%`} render={<Button type="button" variant="ghost" size="sm" />}>{zoom}%<ChevronDownIcon size={12} /></DropdownMenuTrigger></LabelTooltip>
          <DropdownMenuContent align="end" style={{ minWidth: 110 }}>
            <DropdownMenuRadioGroup value={String(zoom)} onValueChange={value => void changeZoom(Number(value))}>
              {ZOOM_LEVELS.map(percent => <DropdownMenuRadioItem key={percent} value={String(percent)}>{percent}%{percent === 100 ? "（默认）" : ""}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <LabelTooltip content="放大网页"><Button type="button" variant="ghost" size="sm" aria-label="放大网页" disabled={zoomDisabled || largerZoom === undefined} onClick={() => { if (largerZoom !== undefined) void changeZoom(largerZoom); }}><PlusIcon size={14} /></Button></LabelTooltip>
      </div>
    </form>
    {error && <div className="browser-notice" role="alert">{error}<LabelTooltip content={t(spec.browserMode !== "temporary" ? "automation.accounts.restartHint" : "automation.restartHint")}><button disabled={stopPhase === "stopping"} onClick={restart}>{t("automation.reopen")}</button></LabelTooltip></div>}
    {snapshot.notice && <div className="browser-notice" role="status">{snapshot.notice}</div>}
    <div ref={slot} className="browser-viewport browser-native-viewport" data-native-browser-slot>
      {!snapshot.opened && <div className="browser-empty">{t(`automation.phase.${phase}`)}{stopPhase === "stopped" && <><p>{t(spec.browserMode !== "temporary" ? "automation.accounts.stoppedHint" : "automation.stoppedHint")}</p><button onClick={restart}>{t("automation.reopen")}</button></>}</div>}
    </div>
  </section>;
}
