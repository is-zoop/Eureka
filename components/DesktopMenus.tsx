"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Menu } from "@base-ui/react/menu";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import { notify } from "@/lib/notification-store";
import {
  DESKTOP_MENU_ACTION_EVENT, DESKTOP_MENU_IDS, DESKTOP_MENU_OPEN_EVENT, EMPTY_DESKTOP_MENU_CONTEXT,
  dispatchDesktopMenuCommand, getDesktopMenuContext, getDesktopEditShortcut, getDesktopShortcut, isDesktopMenuId, subscribeDesktopMenuContext,
  type DesktopMenuCommand, type DesktopMenuId,
} from "@/lib/desktop-menu";
import { captureDesktopEditTarget, executeDesktopEdit, restoreDesktopEditTarget, type DesktopEditCommand, type DesktopEditTarget } from "@/lib/desktop-edit";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./ui/alert-dialog";
import { LabelTooltip } from "./LabelTooltip";
import { version } from "@/package.json";
import styles from "./DesktopMenus.module.css";

const EDIT_COMMANDS = new Set<DesktopMenuCommand>(["undo", "redo", "cut", "copy", "paste", "select-all"]);
const VIEW_COMMANDS = new Set<DesktopMenuCommand>(["zoom-in", "zoom-out", "zoom-reset", "fullscreen", "quit"]);
const isNative = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const EMPTY_EDIT_TARGET: DesktopEditTarget = { element: null, range: null, start: null, end: null, text: "", editable: false };
type MenuLocation = { menu: DesktopMenuId; x: number };

export function DesktopMenus() {
  const { t } = useI18n();
  const context = useSyncExternalStore(subscribeDesktopMenuContext, getDesktopMenuContext, () => EMPTY_DESKTOP_MENU_CONTEXT);
  const [location, setLocation] = useState<MenuLocation | null>(null);
  const [zoom, setZoom] = useState(1);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const openRef = useRef<MenuLocation | null>(null);
  const targetRef = useRef<DesktopEditTarget>(EMPTY_EDIT_TARGET);
  const popupRef = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => DESKTOP_MENU_IDS.map((id) => t(`desktop.menu.${id}`)), [t]);

  const report = useCallback((error: unknown) => {
    console.error("Desktop menu action failed:", error);
    notify({ type: "error", message: t("desktop.actionFailed") });
  }, [t]);

  const close = useCallback((restoreFocus = false) => {
    const closedMenu = openRef.current?.menu;
    openRef.current = null;
    setLocation(null);
    if (restoreFocus) restoreDesktopEditTarget(targetRef.current, document);
    if (closedMenu && isNative()) void invoke("desktop_close_menu", { menu: closedMenu }).catch(report);
  }, [report]);

  const perform = useCallback(async (command: DesktopMenuCommand, path?: string) => {
    const editTarget = targetRef.current;
    close();
    try {
      if (EDIT_COMMANDS.has(command)) {
        // Let the popup finish unmounting before restoring the editor, otherwise
        // its focus cleanup can move focus away after an editing operation.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await executeDesktopEdit(command as DesktopEditCommand, editTarget, document);
      } else if (VIEW_COMMANDS.has(command)) {
        if (isNative()) {
          const state = await invoke<{ zoom: number }>("desktop_view_action", { action: command });
          setZoom(state.zoom);
        }
      } else if (command === "about") {
        setAboutOpen(true);
      } else if (command === "logout") {
        if (!context.authenticated || loggingOut) return;
        setLoggingOut(true);
        try { await fetch("/api/marketplace-auth/logout", { method: "POST" }); }
        finally { window.location.replace("/login"); }
      } else {
        dispatchDesktopMenuCommand({ command, path });
      }
    } catch (error) { report(error); }
  }, [close, context.authenticated, loggingOut, report]);

  useEffect(() => {
    if (!isNative()) return;
    void invoke("set_desktop_menu_state", { ready: true, labels }).catch(report);
    void invoke<{ zoom: number }>("desktop_view_action", { action: "state" }).then((state) => setZoom(state.zoom)).catch(report);
  }, [labels, report]);

  useEffect(() => () => {
    if (isNative()) void invoke("set_desktop_menu_state", { ready: false, labels: [] }).catch(console.error);
  }, []);

  useEffect(() => {
    const rememberTarget = () => {
      if (openRef.current) return;
      const active = document.activeElement;
      if (active instanceof Element && active.closest('[data-desktop-menu-popup], [role="dialog"], [role="alertdialog"]')) return;
      targetRef.current = captureDesktopEditTarget(document);
    };
    const open = (event: Event) => {
      const request = (event as CustomEvent).detail;
      if (request?.menu === null) { close(true); return; }
      if (!isDesktopMenuId(request?.menu) || !Number.isFinite(request?.x) || request.x < 0) return;
      // A native caption click can blur the content WebView before this event
      // arrives. Retain the captured input/selection in that case.
      if (document.activeElement !== document.body || !targetRef.current.element?.isConnected) rememberTarget();
      const next: MenuLocation = { menu: request.menu, x: request.x };
      openRef.current = next;
      setLocation(next);
    };
    const action = (event: Event) => {
      const command = (event as CustomEvent).detail?.command as DesktopMenuCommand;
      if (EDIT_COMMANDS.has(command) || VIEW_COMMANDS.has(command) || ["new-task", "settings"].includes(command)) {
        if (document.activeElement !== document.body || !targetRef.current.element?.isConnected) rememberTarget();
        void perform(command);
      }
    };
    const shortcut = (event: KeyboardEvent) => {
      if (!isNative() || event.defaultPrevented) return;
      if (event.key === "F10") {
        event.preventDefault();
        void invoke("desktop_cycle_menu", { direction: 0 }).catch(report);
        return;
      }
      const command = getDesktopShortcut(event) ?? (openRef.current ? getDesktopEditShortcut(event) : null);
      if (!command) return;
      if ((command === "new-task" && !context.cwd) || (["settings", "toggle-sidebar", "toggle-files"].includes(command) && !context.ready)) return;
      event.preventDefault();
      rememberTarget();
      void perform(command);
    };
    document.addEventListener("focusin", rememberTarget);
    document.addEventListener("selectionchange", rememberTarget);
    document.addEventListener("pointerup", rememberTarget);
    const onBlur = () => { if (document.activeElement !== document.body) rememberTarget(); };
    window.addEventListener("blur", onBlur);
    window.addEventListener(DESKTOP_MENU_OPEN_EVENT, open);
    window.addEventListener(DESKTOP_MENU_ACTION_EVENT, action);
    window.addEventListener("keydown", shortcut, true);
    return () => {
      document.removeEventListener("focusin", rememberTarget);
      document.removeEventListener("selectionchange", rememberTarget);
      document.removeEventListener("pointerup", rememberTarget);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener(DESKTOP_MENU_OPEN_EVENT, open);
      window.removeEventListener(DESKTOP_MENU_ACTION_EVENT, action);
      window.removeEventListener("keydown", shortcut, true);
    };
  }, [close, context.cwd, context.ready, perform, report]);

  useEffect(() => {
    if (location) popupRef.current?.focus({ preventScroll: true });
  }, [location]);

  const anchor = useMemo(() => ({ getBoundingClientRect: () => new DOMRect((location?.x ?? 0) / zoom, 0, 0, 0) }), [location?.x, zoom]);
  const item = (command: DesktopMenuCommand, label: string, shortcut?: string, disabled = false) => (
    <Menu.Item key={command} className={styles.item} disabled={disabled} onClick={() => void perform(command)}>
      <span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}
    </Menu.Item>
  );
  const separator = (key: string) => <Menu.Separator key={`separator-${key}`} className={styles.separator} />;
  const edit = targetRef.current;

  return <>
    <Menu.Root key={location?.menu ?? "closed"} open={location !== null} modal={false} onOpenChange={(open, details) => { if (!open) close(details.reason === "escape-key"); }}>
      {/* The native caption is the visible trigger. Base UI still needs a local
          trigger to register the floating tree identity for nested menus. */}
      <Menu.Trigger tabIndex={-1} aria-hidden="true" style={{ display: "none" }} />
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={3} collisionPadding={4} positionMethod="fixed" className={styles.positioner}>
          <Menu.Popup ref={popupRef} className={styles.popup} data-desktop-menu-popup aria-label={location ? t(`desktop.menu.${location.menu}`) : undefined} finalFocus={false} onKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-desktop-menu-popup]') !== event.currentTarget) return;
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            if (event.key === "ArrowRight" && event.target instanceof Element && event.target.closest('[data-recent-projects-trigger]')) return;
            if (!isNative()) return;
            event.preventDefault(); event.stopPropagation();
            void invoke("desktop_cycle_menu", { direction: event.key === "ArrowLeft" ? -1 : 1 }).catch(report);
          }}>
            {location?.menu === "file" && <>
              {item("new-task", t("sidebar.new"), "Ctrl+Alt+N", !context.cwd)}
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className={styles.item} data-recent-projects-trigger disabled={!context.ready || context.projects.length === 0}>
                  <span>{t("desktop.recentProjects")}</span><span className={styles.arrow} aria-hidden="true">›</span>
                </Menu.SubmenuTrigger>
                <Menu.Portal><Menu.Positioner side="right" align="start" sideOffset={4} alignOffset={-5} collisionPadding={8} className={styles.positioner}>
                  <Menu.Popup className={`${styles.popup} ${styles.projects}`} data-desktop-menu-popup aria-label={t("desktop.recentProjects")} finalFocus={false}>
                    {context.projects.map((path) => <LabelTooltip key={path} content={path} side="right"><Menu.Item className={styles.item} aria-label={`${getFileName(path) || path} ${path}`} onClick={() => void perform("select-project", path)}>
                      <span className={styles.projectName}>{getFileName(path) || path}</span><span className={styles.projectPath}>{path}</span>
                    </Menu.Item></LabelTooltip>)}
                  </Menu.Popup>
                </Menu.Positioner></Menu.Portal>
              </Menu.SubmenuRoot>
              {separator("account")}
              {item("logout", t("account.logout"), undefined, !context.authenticated || loggingOut)}
              {separator("quit")}
              {item("quit", t("desktop.quit"), "Alt+F4")}
            </>}
            {location?.menu === "edit" && <>
              {item("undo", t("desktop.undo"), "Ctrl+Z", !edit.editable)}
              {item("redo", t("desktop.redo"), "Ctrl+Y", !edit.editable)}
              {separator("clipboard")}
              {item("cut", t("desktop.cut"), "Ctrl+X", !edit.editable || !edit.text)}
              {item("copy", t("i18n.copy"), "Ctrl+C", !edit.text)}
              {item("paste", t("desktop.paste"), "Ctrl+V", !edit.editable)}
              {separator("selection")}
              {item("select-all", t("desktop.selectAll"), "Ctrl+A")}
              {separator("settings")}
              {item("settings", t("account.settings"), "Ctrl+,", !context.ready)}
            </>}
            {location?.menu === "view" && <>
              {item("toggle-sidebar", t("desktop.toggleSidebar"), "Ctrl+B", !context.ready)}
              {item("toggle-files", t("desktop.toggleFiles"), "Ctrl+Shift+B", !context.ready)}
              {separator("zoom")}
              {item("zoom-in", t("desktop.zoomIn"), "Ctrl++", zoom >= 1.6)}
              {item("zoom-out", t("desktop.zoomOut"), "Ctrl+−", zoom <= .7)}
              {item("zoom-reset", t("desktop.actualSize"), "Ctrl+0")}
              {separator("fullscreen")}
              {item("fullscreen", t("desktop.fullscreen"), "F11")}
            </>}
            {location?.menu === "help" && item("about", t("desktop.about"))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <AlertDialog open={aboutOpen} onOpenChange={setAboutOpen}>
      <AlertDialogContent className="gap-3 p-6">
        <div className={styles.aboutLogo} aria-hidden="true" />
        <AlertDialogTitle>{t("desktop.about")}</AlertDialogTitle>
        <div className={styles.version}>Eureka {version}</div>
        <AlertDialogDescription>{t("desktop.aboutDescription")}</AlertDialogDescription>
        <div className="mt-4 flex"><AlertDialogCancel>{t("i18n.close")}</AlertDialogCancel></div>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
