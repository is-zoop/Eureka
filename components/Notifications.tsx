"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircleIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { notificationStore, notify, dismiss, type NotificationInput, type NotificationItem, type NoticeType } from "@/lib/notification-store";
import { useI18n } from "@/hooks/useI18n";

const empty: NotificationItem[] = [];
const AUTO_DISMISS_MS = 3_000;
const tones = {
  // Keep the container neutral; severity is conveyed by the icon and copy,
  // matching the shadcn Alert examples supplied for this screen.
  error: { icon: AlertCircleIcon, color: "#f87171", descriptionColor: "var(--text-muted)" },
  warning: { icon: AlertTriangleIcon, color: "#fbbf24", descriptionColor: "var(--text-muted)" },
  success: { icon: CheckCircle2Icon, color: "var(--text)", descriptionColor: "var(--text-muted)" },
  info: { icon: InfoIcon, color: "var(--text)", descriptionColor: "var(--text-muted)" },
};

/** Bridge existing state-based feedback to the global layer without a layout box. */
export function NotificationNotice({ message, details, type = "error", title, eventKey, action }: { message?: string | null; details?: string; type?: NoticeType; title?: string; eventKey?: string; action?: NotificationInput["action"] }) {
  const instance = useId();
  const previous = useRef("");
  const revision = useRef(0);
  useEffect(() => {
    const value = message?.trim() ?? "";
    const signature = JSON.stringify([value, details, type, title, eventKey]);
    if (previous.current === signature) return;
    previous.current = signature;
    if (value) notify({ id: eventKey ?? `${instance}:${++revision.current}`, message: value, details, type, title, action });
  }, [message, details, type, title, eventKey, instance, action]);
  return null;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot, () => empty);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    // Observe actual content bounds, including sidebar resize transitions. A
    // persistent notification must not keep an idle animation loop running.
    if (!items.length) return;
    let frame: number | null = null;
    const observed = new Set<Element>();
    const measure = () => {
      frame = null;
      const targets = [...document.querySelectorAll<HTMLElement>("[data-notification-boundary]")]
        .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
      const target = targets.sort((a, b) => Number(b.dataset.notificationBoundary) - Number(a.dataset.notificationBoundary))[0];
      const rect = target?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--desktop-titlebar-height")) || 0;
      const left = Math.max(rect?.left ?? 0, viewport?.offsetLeft ?? 0);
      const right = Math.min(rect?.right ?? window.innerWidth, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth));
      const start = Math.max(rect?.top ?? titlebar, top);
      const next = { left, top: start, width: Math.max(0, right - left), height: Math.max(0, Math.min(rect?.bottom ?? window.innerHeight, top + height) - start) };
      setBounds((old) => old && Object.keys(next).every((key) => old[key as keyof typeof next] === next[key as keyof typeof next]) ? old : next);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    const resizeObserver = new ResizeObserver(schedule);
    const syncTargets = () => {
      const targets = new Set<Element>([document.documentElement, ...document.querySelectorAll("[data-notification-boundary]")]);
      for (const element of observed) {
        if (!targets.has(element)) { resizeObserver.unobserve(element); observed.delete(element); }
      }
      for (const element of targets) {
        if (!observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
      }
      schedule();
    };
    const mutationObserver = new MutationObserver(syncTargets);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "inert"] });
    syncTargets();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [items.length]);

  return <>{children}{bounds && items.length > 0 && createPortal(
    <div data-notification-layer="" className="notification-layer" style={{ position: "fixed", zIndex: 2000, transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", overscrollBehavior: "contain", pointerEvents: "none", boxSizing: "border-box", padding: 16, left: bounds.left + bounds.width / 2, top: `calc(${bounds.top + 8}px + env(safe-area-inset-top))`, width: Math.max(0, Math.min(592, bounds.width)), maxHeight: bounds.height * 0.6 }}>
      {items.map((item) => <NotificationCard key={item.id} item={item} />)}
    </div>, document.body
  )}</>;
}

function NotificationCard({ item }: { item: NotificationItem }) {
  const { t } = useI18n();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsOpenRef = useRef(false);
  const tone = tones[item.type];
  const title = item.title || t(`notifications.${item.type}`);
  const Icon = tone.icon;
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const startTimer = useCallback(() => {
    clearTimer();
    if (detailsOpenRef.current) return;
    timerRef.current = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
  }, [clearTimer, item.id]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [clearTimer, startTimer]);

  return <Alert
    role={item.type === "error" || item.type === "warning" ? "alert" : "status"}
    className="notification-card"
    style={{ flexShrink: 0, pointerEvents: "auto", borderColor: "var(--border)" }}
    onMouseEnter={clearTimer}
    onMouseLeave={startTimer}
    onFocusCapture={clearTimer}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) startTimer(); }}
  >
    <Icon aria-hidden="true" style={{ color: item.type === "success" ? "var(--notification-success)" : tone.color }} />
    <AlertTitle style={{ color: tone.color }}>{title}</AlertTitle>
    <AlertDescription style={{ color: tone.descriptionColor }}>{item.message}{item.details ? <details className="mt-2 w-full min-w-0" onToggle={event => { detailsOpenRef.current = event.currentTarget.open; if (detailsOpenRef.current) clearTimer(); else startTimer(); }}><summary className="w-fit cursor-pointer text-xs">{t("notifications.details")}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs font-mono">{item.details}</pre></details> : null}{item.action && <button type="button" className="mt-2 block rounded border border-current px-2 py-1 text-xs font-medium" onClick={item.action.onClick}>{item.action.label}</button>}</AlertDescription>
    <AlertAction><button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" style={{ color: tone.color }} aria-label={t("notifications.close", { title })} onClick={() => dismiss(item.id)}><XIcon className="h-4 w-4" /></button></AlertAction>
  </Alert>;
}
