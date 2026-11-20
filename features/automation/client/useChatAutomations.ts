"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../hooks/useI18n";
import { readAutomationResponse } from "@/features/automation/shared/automation-response";
import type { AutomationAppDetail } from "@/features/automation/shared/automation-app";
import type { AutomationChatInvocation } from "@/features/automation/runtime/automation-chat";
import { appRunActive, type AppRunRecord } from "@/features/automation/runtime/automation-app-run";
import { chatAutomationAnchors } from "@/features/automation/shared/automation-chat-display";
import type { AgentMessage } from "@/lib/types";

export interface ChatAutomationSnapshot {
  invocation: AutomationChatInvocation;
  detail: AutomationAppDetail | null;
  run: AppRunRecord | null;
  ownerKey: string;
  runtimeId: string;
  error?: string;
}

/** Headless browser ownership and exceptional file prompts, independent of UI. */
export function useChatAutomations(sessionId: string | undefined, messages: AgentMessage[]) {
  const { t } = useI18n();
  const translation = useRef(t); translation.current = t;
  const anchors = useMemo(() => chatAutomationAnchors(messages), [messages]);
  const [state, setState] = useState<{ sessionId: string; snapshots: ChatAutomationSnapshot[] } | null>(null);
  const [error, setError] = useState("");
  const enabled = anchors.length > 0;
  useEffect(() => {
    setState(null); setError("");
    if (!sessionId || !enabled) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/automation/chat?mode=list&sessionId=${encodeURIComponent(sessionId)}`, {
          cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (abort.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setState(null); setError(""); }
        else {
          const data = await readAutomationResponse<{invocations:ChatAutomationSnapshot[]}>(response, translation.current("automationUi.readFailed"), translation.current("automationUi.invalidResponse", {status:response.status}));
          if (abort.signal.aborted) return;
          if (Array.isArray(data?.invocations)) { setState({ sessionId, snapshots: data.invocations }); setError(""); }
          else setError(translation.current("automationUi.readFailed"));
        }
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : translation.current("automationUi.readFailed")); }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [sessionId, enabled]);
  const snapshots = useMemo(() => {
    const ids = new Set(anchors.map(anchor => anchor.id));
    return new Map((state && state.sessionId === sessionId ? state.snapshots : [])
      .filter(snapshot => ids.has(snapshot.invocation.id)).map(snapshot => [snapshot.invocation.id, snapshot]));
  }, [state, sessionId, anchors]);
  const current = [...snapshots.values()].find(snapshot => snapshot.invocation.runtimeId === snapshot.runtimeId && snapshot.run && appRunActive(snapshot.run.status));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("eureka:chat-automation-state", { detail: {
      sessionId, ownerKey: current?.ownerKey ?? "", runtimeId: current?.runtimeId ?? "",
      appId: current?.invocation.appId ?? null, runId: current?.run?.id, active: Boolean(current),
    } }));
    return () => { window.dispatchEvent(new CustomEvent("eureka:chat-automation-state", { detail: { sessionId, appId: null, active: false } })); };
  }, [sessionId, current?.ownerKey, current?.runtimeId, current?.invocation.appId, current?.run?.id]);
  return { snapshots, error };
}
