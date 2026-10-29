"use client";

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@/hooks/useI18n";
import { dispatchDesktopMenuCommand } from "@/lib/desktop-menu";
import { DESKTOP_TRAY_ACTION_EVENT } from "@/lib/desktop-tray";
import { getSessionDisplayTitle } from "@/lib/session-display-title";
import type { SessionInfo } from "@/lib/types";

type TrayAction = { command: "new-task" | "settings" | "select-session"; sessionId?: string };
const isNative = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useDesktopTray({ sessions, canCreate, onSelectSession }: {
  sessions: SessionInfo[];
  canCreate: boolean;
  onSelectSession: (session: SessionInfo) => void;
}) {
  const { t } = useI18n();
  const current = useRef({ sessions, canCreate, onSelectSession });
  useEffect(() => { current.current = { sessions, canCreate, onSelectSession }; }, [sessions, canCreate, onSelectSession]);

  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<TrayAction>(DESKTOP_TRAY_ACTION_EVENT, ({ payload }) => {
      if (disposed) return;
      if (payload.command === "select-session") {
        const session = current.current.sessions.find((item) => item.id === payload.sessionId);
        if (session) current.current.onSelectSession(session);
      } else if (payload.command === "settings" || (payload.command === "new-task" && current.current.canCreate)) {
        dispatchDesktopMenuCommand({ command: payload.command });
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(console.error);
    const clear = () => { void invoke("set_desktop_tray_state", { recentSessions: [], ready: false, canCreate: false }).catch(console.error); };
    window.addEventListener("pagehide", clear);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("pagehide", clear);
      clear();
    };
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    const recentSessions = sessions.map((session) => ({
      id: session.id,
      title: getSessionDisplayTitle(session, t("sidebar.new")),
    }));
    void invoke("set_desktop_tray_state", { recentSessions, ready: true, canCreate }).catch(console.error);
  }, [sessions, canCreate, t]);
}
