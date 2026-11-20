"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { notify } from "@/features/workspace/shared/notification-store";

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function useSessionAutoName(
  activeSessionId: string | undefined,
  onStart: () => void,
  onTitle: (sessionId: string, title: string) => void,
) {
  const { t } = useI18n();
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const activeSessionIdRef = useRef(activeSessionId);
  const namingSessionIds = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    setAutoNameStatus({ kind: activeSessionId && namingSessionIds.current.has(activeSessionId) ? "naming" : "idle" });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activeSessionId]);

  const handleAutoName = useCallback(async (sessionId = activeSessionId) => {
    if (!sessionId || namingSessionIds.current.has(sessionId)) return;
    namingSessionIds.current.add(sessionId);
    if (activeSessionIdRef.current === sessionId) {
      if (timer.current) clearTimeout(timer.current);
      onStart();
      setAutoNameStatus({ kind: "naming" });
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) throw new Error(body.error || `HTTP ${response.status}`);

      onTitle(sessionId, body.title.trim());
      notify({ type: "success", message: t("title.updated") });
      if (activeSessionIdRef.current !== sessionId) return;
      setAutoNameStatus({ kind: "success" });
      timer.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify({ type: "error", message });
      if (activeSessionIdRef.current !== sessionId) return;
      setAutoNameStatus({ kind: "error", message });
      timer.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    } finally {
      namingSessionIds.current.delete(sessionId);
    }
  }, [activeSessionId, onStart, onTitle, t]);

  return { autoNameStatus, handleAutoName };
}
