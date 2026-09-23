"use client";

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useTheme } from "@/hooks/useTheme";

function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function MinimizeGlyph() {
  return <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: 12, height: 12, fill: "none", stroke: "currentColor", strokeLinecap: "square", strokeWidth: 1.1 }}><path d="M2 6.5h8" /></svg>;
}

function MaximizeGlyph() {
  return <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: 12, height: 12, fill: "none", stroke: "currentColor", strokeLinecap: "square", strokeWidth: 1.1 }}><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg>;
}

function RestoreGlyph() {
  return <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: 12, height: 12, fill: "none", stroke: "currentColor", strokeLinecap: "square", strokeWidth: 1.1 }}><rect x="4" y="2" width="6" height="6" /><path d="M8 8v2H2V4h2" /></svg>;
}

function CloseGlyph() {
  return <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: 12, height: 12, fill: "none", stroke: "currentColor", strokeLinecap: "square", strokeWidth: 1.1 }}><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>;
}

/**
 * Visual frame only: all window movement and state transitions remain owned
 * by Tauri and Windows. The first version deliberately does not emulate the
 * Windows 11 maximize-button Snap Layout popup.
 */
export function DesktopTitlebar() {
  const { isDark } = useTheme();
  const [desktop, setDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    document.documentElement.classList.add("eureka-desktop");
    setDesktop(true);
    const appWindow = getCurrentWindow();
    const syncMaximized = () => {
      void appWindow.isMaximized().then(setMaximized).catch(() => {});
    };
    syncMaximized();

    let active = true;
    const listeners: Promise<UnlistenFn>[] = [
      appWindow.onResized(syncMaximized),
      appWindow.onFocusChanged(({ payload }) => {
        if (active) setFocused(payload);
      }),
    ];

    return () => {
      active = false;
      for (const listener of listeners) {
        void listener.then((unlisten) => unlisten());
      }
    };
  }, []);

  // Keep the browser/PWA surface exactly as before. These dimensions are
  // intentionally inline: the window frame must not briefly become a normal
  // document block while development stylesheets are being hot-replaced.
  if (!desktop) return null;

  const minimize = () => {
    if (!isTauriDesktop()) return;
    void getCurrentWindow().minimize();
  };
  const toggleMaximize = () => {
    if (!isTauriDesktop()) return;
    const appWindow = getCurrentWindow();
    void appWindow.toggleMaximize().then(() => {
      void appWindow.isMaximized().then(setMaximized).catch(() => {});
    });
  };
  const close = () => {
    if (!isTauriDesktop()) return;
    void getCurrentWindow().close();
  };

  return (
    <>
    <header
      className={`desktop-titlebar${focused ? "" : " desktop-titlebar-unfocused"}`}
      aria-label="Eureka window controls"
      style={{ display: "flex", position: "fixed", zIndex: 1000, inset: "0 0 auto", height: 32, minHeight: 32, color: "var(--text)", background: "var(--sidebar-bg)", userSelect: "none" }}
    >
      <div className="desktop-titlebar-drag" data-tauri-drag-region onDoubleClick={toggleMaximize} style={{ display: "flex", flex: 1, alignItems: "center", minWidth: 0, paddingLeft: 10 }}>
        <img className="desktop-titlebar-icon" src={isDark ? "/icons/logo-white-transparent.png" : "/icons/logo-black-transparent.png"} alt="" draggable={false} data-tauri-drag-region style={{ width: 16, height: 16, marginRight: 6, flex: "0 0 16px" }} />
        <span className="desktop-titlebar-name" data-tauri-drag-region>Eureka</span>
      </div>
      <div className="desktop-titlebar-controls" aria-label="Window controls" style={{ display: "flex", flex: "0 0 auto", height: 32 }}>
        <button type="button" className="desktop-caption-button" onClick={minimize} aria-label="Minimize" style={{ display: "grid", placeItems: "center", flex: "0 0 46px", width: 46, height: 32 }}><MinimizeGlyph /></button>
        <button type="button" className="desktop-caption-button" onClick={toggleMaximize} aria-label={maximized ? "Restore" : "Maximize"} style={{ display: "grid", placeItems: "center", flex: "0 0 46px", width: 46, height: 32 }}>
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </button>
        <button type="button" className="desktop-caption-button desktop-caption-close" onClick={close} aria-label="Close" style={{ display: "grid", placeItems: "center", flex: "0 0 46px", width: 46, height: 32 }}><CloseGlyph /></button>
      </div>
    </header>
    </>
  );
}
