"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseAutomationTaskRef, type AutomationTaskRef, type AutomationLaunchRequest } from "@/lib/automation-mode";
interface Options { draftKey?: string; sessionId: string | null; launchRequest?: AutomationLaunchRequest | null; onLaunchHandled?: () => void; recover?: boolean; busy: boolean; planActive: boolean; toolsOff: boolean; notify: (message: string) => void }
const keyFor = (key: string) => `eureka:automation-mode:${key}`;
function stored(key?: string): AutomationTaskRef | null { if (!key) return null; try { return parseAutomationTaskRef(JSON.parse(localStorage.getItem(keyFor(key)) ?? "null")); } catch { return null; } }
function remember(key: string | undefined, task: AutomationTaskRef | null) { if (!key) return; try { if (task) localStorage.setItem(keyFor(key), JSON.stringify(task)); else localStorage.removeItem(keyFor(key)); } catch { /* Server task state remains authoritative. */ } }
export function useAutomationMode(options: Options) {
  const optionsRef = useRef(options); optionsRef.current = options;
  const [task, setTask] = useState<AutomationTaskRef | null>(null), [ready, setReady] = useState(false), [changing, setChanging] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null), [refresh, setRefresh] = useState(0), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<{ name: string } | null>(null);
  const loadError = useRef<string | null>(null);
  const restoring = useRef(false);
  const launch = options.launchRequest && options.launchRequest.draftKey === options.draftKey && dismissedKey !== options.draftKey ? options.launchRequest : null;
  const recover = Boolean(options.recover && dismissedKey !== options.draftKey);
  const current = useRef<AutomationTaskRef | null>(null), session = useRef<string | null>(options.sessionId), draft = useRef(options.draftKey), epoch = useRef(0);
  const identity = useRef<{ ownerKey: string; runtimeId: string } | null>(null);
  const edits = useRef(0);
  const loads = useRef(0);
  const hydrated = useRef(false);
  const publish = useCallback((next: AutomationTaskRef | null) => { current.current = next; setTask(next); remember(draft.current, next); }, []);
  const pause = useCallback(async (exit: boolean) => {
    const selected = current.current, sid = session.current; if (!selected || !sid) return;
    const response = await fetch("/api/automation/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify({ mode: exit ? "exit" : "pause", sessionId: sid, task: selected }) });
    if (!response.ok) throw new Error("创建任务暂停或退出未确认，请重试。");
  }, []);
  useEffect(() => {
    let alive = true; const revision = ++epoch.current, abort = new AbortController();
    // Promotion keeps the same task while the new-session draft becomes a real session.
    const promoted = options.sessionId && session.current === options.sessionId && current.current;
    const keepCurrent = promoted || draft.current === options.draftKey && session.current === options.sessionId && current.current;
    // Changing the displayed conversation is not a cancellation request.
    draft.current = options.draftKey; session.current = options.sessionId ?? session.current;
    hydrated.current = false; setReady(false); if (!keepCurrent) { current.current = null; setTask(null); session.current = options.sessionId; }
    loadError.current = null; setError(null);
    restoring.current = Boolean(launch || recover);
    if (!keepCurrent) setApplication(launch?.baseApp ? { name: launch.displayName || launch.baseApp.id } : null);
    const load = async () => {
      const edit = edits.current, attempt = ++loads.current;
      const fresh = () => alive && epoch.current === revision && attempt === loads.current && edit === edits.current;
      try {
        // Ordinary chats do not depend on Haze/task recovery. Discover task markers from the normal history read first.
        const requestKey = `eureka:automation-request:${options.draftKey}`;
        let requested: Omit<AutomationLaunchRequest, "draftKey"> | null = launch;
        let navigationValue: string | null = null;
        try { navigationValue = sessionStorage.getItem(requestKey); } catch { /* React carries the explicit navigation intent. */ }
        if (!requested && navigationValue && dismissedKey !== options.draftKey) {
          const value: unknown = JSON.parse(navigationValue);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("自动化修改入口信息损坏，请从应用菜单重新打开。");
          requested = value as Omit<AutomationLaunchRequest, "draftKey">;
        }
        if (!recover && !current.current && !stored(options.draftKey) && !requested) { if (fresh()) { restoring.current = false; hydrated.current = true; setPending(false); setReady(true); } return; }
        restoring.current = true;
        setPending(true); setReady(false);
        const response = await fetch(`/api/automation/tasks${options.sessionId ? `?sessionId=${encodeURIComponent(options.sessionId)}` : ""}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) }); const data = await response.json();
        if (!response.ok || typeof data.ownerKey !== "string" || typeof data.runtimeId !== "string") throw new Error();
        if (!fresh()) return;
        if (requested && (requested.ownerKey !== undefined && requested.ownerKey !== data.ownerKey || requested.runtimeId !== undefined && requested.runtimeId !== data.runtimeId)) throw new Error("登录身份已变化，请从当前账号的应用菜单重新打开修改。");
        identity.current = { ownerKey: data.ownerKey, runtimeId: data.runtimeId };
        const cached = current.current ?? stored(options.draftKey), server = data.mode?.task ? parseAutomationTaskRef(data.mode.task) : null;
        const selected = (current.current?.id === data.closedTaskId ? null : current.current) ?? server ?? (cached?.id === data.closedTaskId ? null : cached) ?? (requested ? parseAutomationTaskRef({ id: crypto.randomUUID(), ownerKey: data.ownerKey, runtimeId: data.runtimeId, ...(requested.baseApp?{baseApp:requested.baseApp}:{}) }) : null);
        if (selected && (selected.ownerKey !== data.ownerKey || selected.runtimeId !== data.runtimeId)) throw new Error("创建任务的登录身份已变化，请从应用菜单重新打开修改。");
        if (requested?.baseApp && JSON.stringify(requested.baseApp) !== JSON.stringify(selected?.baseApp)) throw new Error("应用修改对象不一致，请从应用菜单重新打开。");
        if (selected?.baseApp) {
          const response = await fetch(`/api/automation/apps/${encodeURIComponent(selected.baseApp.id)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
          const detail = await response.json();
          if (!response.ok) throw new Error(detail.error || "无法读取待修改应用。");
          if (detail.ownerKey !== data.ownerKey || detail.runtimeId !== data.runtimeId || detail.install?.id !== selected.baseApp.id) throw new Error("应用所属账号已变化，请重新打开修改。");
          if (detail.install.revision !== selected.baseApp.revision || detail.manifest?.version !== selected.baseApp.version) throw new Error("原应用版本已变化，请从应用菜单重新打开修改。");
          if (typeof detail.manifest.displayName !== "string" || !detail.manifest.displayName.trim()) throw new Error("待修改应用的信息不完整。");
          if (!fresh()) return;
          setApplication({ name: detail.manifest.displayName });
        } else setApplication(null);
        if (selected) publish(selected); else publish(null);
        // Keep the fallback until the task reference is safely published. A
        // failed/aborted load must not turn a modification into an ordinary chat.
        if (requested) { try { sessionStorage.removeItem(requestKey); } catch {} optionsRef.current.onLaunchHandled?.(); }
        setPending(false); restoring.current = false; loadError.current = null; setError(null);
        hydrated.current = true; setReady(true);
      } catch (e) { if (!abort.signal.aborted && fresh()) {
        const message = e instanceof Error && e.message ? e.message : "无法载入自动化上下文，请重试；不会按普通聊天发送。";
        identity.current = null; loadError.current = message; setError(message); setPending(true); hydrated.current = true; setReady(true);
      } }
    };
    void load(); const focus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { alive = false; abort.abort(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [options.draftKey, options.sessionId, recover, launch, dismissedKey, refresh, publish]);
  useEffect(() => {
    const leave = (event:Event) => { const scope=(event as CustomEvent<{taskId?:string;runId?:string;sessionId?:string}>).detail;if(scope?.taskId&&scope.taskId!==current.current?.id||scope?.sessionId&&scope.sessionId!==session.current||scope?.runId&&!scope.taskId)return;void pause(false).catch(() => {}); };
    window.addEventListener("eureka:automation-pause", leave);
    return () => { window.removeEventListener("eureka:automation-pause", leave); };
  }, [pause]);
  const enable = useCallback(async () => {
    const o = optionsRef.current; if (o.busy) throw new Error("请等待当前运行结束后再选择自动化。");
    if (o.planActive) throw new Error("请先结束计划模式，再选择自动化。");
    if (o.toolsOff) throw new Error("全部工具已关闭，请先开启工具权限。");
    if (current.current) return current.current;
    if (!o.draftKey) throw new Error("请先打开首页对话。");
    const response = await fetch("/api/automation/tasks", { cache: "no-store" }), data = await response.json();
    if (!response.ok) throw new Error("请先登录 Haze，再创建自动化。");
    if (optionsRef.current.draftKey !== o.draftKey) throw new Error("会话已变化，请重新选择。");
    if (optionsRef.current.busy || optionsRef.current.planActive || optionsRef.current.toolsOff) throw new Error("会话运行或权限已变化，请结束当前运行后重新选择。");
    identity.current = { ownerKey: data.ownerKey, runtimeId: data.runtimeId };
    const next = parseAutomationTaskRef({ id: crypto.randomUUID(), ...identity.current }); edits.current++; hydrated.current = true; setReady(true); publish(next); return next;
  }, [publish]);
  const change = useCallback(async (enabled: boolean) => {
    edits.current++; setChanging(true); try { if (enabled) await enable(); else { if (current.current) await pause(true); publish(null); setDismissedKey(optionsRef.current.draftKey ?? null); setPending(false); setApplication(null); restoring.current = false; loadError.current = null; setError(null); try { sessionStorage.removeItem(`eureka:automation-request:${optionsRef.current.draftKey}`); } catch {} optionsRef.current.onLaunchHandled?.(); } } catch (e) { optionsRef.current.notify(e instanceof Error ? e.message : "自动化模式切换失败。"); } finally { hydrated.current = true; setReady(true); setChanging(false); }
  }, [enable, pause, publish]);
  const submission = useCallback(() => {
    if (loadError.current) throw new Error(loadError.current);
    if (restoring.current) throw new Error("正在关联自动化应用，请稍后发送。");
    if (!hydrated.current && (current.current || optionsRef.current.recover || stored(optionsRef.current.draftKey))) throw new Error("正在恢复自动化创建状态，请稍后发送。");
    const selected = current.current; if (!selected) return undefined;
    if (selected.ownerKey !== identity.current?.ownerKey || selected.runtimeId !== identity.current?.runtimeId) throw new Error("创建任务的登录身份已变化，请退出该模式后重新选择自动化。");
    if (optionsRef.current.planActive || optionsRef.current.toolsOff) throw new Error("请先退出计划模式并开启工具权限，再继续自动化。");
    return selected;
  }, []);
  const accepted = useCallback((sid: string) => { session.current = sid; remember(sid, current.current); }, []);
  const restore = useCallback((ref: AutomationTaskRef) => { edits.current++; publish(parseAutomationTaskRef(ref)); }, [publish]);
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  return { task, enabled: Boolean(task) || Boolean(launch) || pending, applicationName: application?.name ?? launch?.displayName, error, ready, changing, retry, change, enable, submission, accepted, pause, restore };
}
