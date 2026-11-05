"use client";
import { useEffect, useMemo, useState } from "react";
import type { AutomationAppDetail } from "@/lib/automation-app";
import type { AutomationChatInvocation } from "@/lib/automation-chat";
import { appRunActive, type AppRunRecord } from "@/lib/automation-app-run";
import { chatAutomationAnchors } from "@/lib/automation-chat-display";
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
        const data = await response.json();
        if (abort.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setState(null); setError(""); }
        else if (!response.ok) setError(data.error ?? "读取自动化运行失败。");
        else if (Array.isArray(data?.invocations)) { setState({ sessionId, snapshots: data.invocations }); setError(""); }
        else setError("运行记录格式已变化，请重启服务后刷新。");
      } catch { /* A temporary connection loss must not stop the actual run. */ }
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
