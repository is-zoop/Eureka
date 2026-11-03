"use client";
import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { ChatAutomationSnapshot } from "@/hooks/useChatAutomations";
import { chatAutomationExpanded, type ChatAutomationAnchor } from "@/lib/automation-chat-display";
import { appRunActive } from "@/lib/automation-app-run";
import { AutomationApplication } from "./AutomationApplication";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import styles from "./AutomationApplication.module.css";

export function AutomationChatCard({ anchor, snapshot: current, latestId, error }: {
  anchor: ChatAutomationAnchor; snapshot?: ChatAutomationSnapshot; latestId?: string; error?: string;
}) {
  const [choice, setChoice] = useState<{ latestId: string | undefined; open: boolean }>();
  const open = chatAutomationExpanded(anchor.id, latestId, choice);
  const running = Boolean(current?.run && appRunActive(current.run.status));
  const detail = current?.detail;
  const stale = current && detail && (current.invocation.runtimeId !== current.runtimeId || current.invocation.revision !== detail.install.revision);
  async function prepareRestart(previousRunId:string,nextRunId:string) {
    if (!current) throw new Error("运行记录尚未读取。");
    const response = await fetch("/api/automation/chat", { method:"POST", headers:{"Content-Type":"application/json"}, signal:AbortSignal.timeout(15000),
      body:JSON.stringify({action:"restart",sessionId:current.invocation.sessionId,invocationId:current.invocation.id,ownerKey:current.ownerKey,runtimeId:current.runtimeId,previousRunId,nextRunId}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "无法准备再次运行。");
    return data.runId as string;
  }
  return <Collapsible open={open} onOpenChange={open => setChoice({ latestId, open })}
    className={`${styles.application} ${styles.authoringCard} mb-4`} aria-label="对话调用自动化">
    <div className={styles.authoringHeader}>
      <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="min-w-0 justify-start gap-2 px-0 font-semibold" />}>
        <ChevronDownIcon size={14} className={open ? "shrink-0" : "shrink-0 -rotate-90"} />
        <span className="truncate">{detail?.manifest.displayName ?? anchor.name}</span>
      </CollapsibleTrigger>
      {current && <Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent("eureka:open-automation-app", { detail: { id: current.invocation.appId } }))}>查看自动化</Button>}
    </div>
    <CollapsibleContent>
      {(current?.error || error) && <Alert variant="destructive"><AlertDescription>{current?.error || error}</AlertDescription></Alert>}
      {!current && !error && <p className="text-sm text-text-muted">正在读取运行记录…</p>}
      {stale && !running ? <p>登录或应用版本已变化，请重新选择命令后运行。</p> : current && detail && <div className={styles.authoringPreview}>
        <AutomationApplication key={current.invocation.id} detail={detail} index={{ ownerKey: current.ownerKey, runtimeId: current.runtimeId, apps: [], data: [] }} active={open}
          providedRunId={current.run?.id} requestedRunId={current.invocation.runId} initialValues={current.invocation.values} initialConfigRevision={current.invocation.configRevision} onPrepareRestart={prepareRestart} />
      </div>}
    </CollapsibleContent>
  </Collapsible>;
}
