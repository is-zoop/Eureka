"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { useI18n } from "@/hooks/useI18n";
import { contextCapacity, type ContextControls, type ContextDetails, type ContextCategory } from "@/lib/context-details";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import { LabelTooltip } from "./LabelTooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import styles from "./ContextPopover.module.css";

type ContextTab = "context" | "session";
type Snapshot = { key: string; details: ContextDetails };
const colors: Record<ContextCategory | "free" | "reserved", string> = {
  system: "#8b5cf6", tools: "#10b981", skills: "#f97316", messages: "#3b82f6", other: "#9ca3af",
  free: "var(--bg-hover)", reserved: "var(--border)",
};

function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return (value / (value >= 1_000_000 ? 1_000_000 : 1000)).toFixed(1).replace(/\.0$/, "") + (value >= 1_000_000 ? "M" : "k");
  return Math.round(value).toLocaleString();
}

function ContextRing({ usage }: { usage: ContextUsage | null }) {
  const percent = Math.min(100, Math.max(0, usage?.percent ?? 0));
  return <svg className={styles.ring} width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border)" strokeWidth="2.6" />
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" pathLength="100" strokeDasharray={`${percent} 100`} strokeLinecap="round" transform="rotate(-90 12 12)" />
  </svg>;
}

/** Both tabs share one snapshot and omit session identity metadata. */
export function ContextInspector({ details, usage, stats, controls, tab, onTabChange, loading = false, error = false, onRetry }: {
  details: ContextDetails | null;
  usage: ContextUsage | null;
  stats: SessionStatsInfo | null;
  controls: ContextControls | null;
  tab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  // Only report completions that arrive during this opening of the inspector.
  const [resultAtOpen] = useState(() => controls?.result);
  const current = details?.usage ?? usage ?? stats?.contextUsage ?? { tokens: null, contextWindow: 0, percent: null };
  const capacity = contextCapacity(current, details?.reserveTokens ?? null);
  const estimated = details?.usageEstimated ?? Boolean(current.estimated);
  const breakdown = details?.breakdown ?? [];
  const legend = [
    ...(["system", "tools", "skills", "messages"] as const).map((id) => ({ id, tokens: breakdown.find((part) => part.id === id)?.tokens ?? null })),
    { id: "free" as const, tokens: capacity.available }, { id: "reserved" as const, tokens: capacity.reserved },
    ...breakdown.filter((part) => part.id === "other" && (part.tokens ?? 0) > 0),
  ];
  const parts = [
    ...(breakdown.length ? breakdown : [{ id: "other" as const, tokens: current.tokens }]),
    ...legend.filter((part) => part.id === "free" || part.id === "reserved"),
  ].filter((part) => (part.tokens ?? 0) > 0);
  const busy = Boolean(controls?.busy);
  const compacting = Boolean(controls?.isCompacting);
  const canCompact = Boolean(controls && details?.canCompact && !busy && !compacting && (stats?.totalMessages ?? 0) > 0);
  const note = [t("context.estimateNote"), details?.source === "snapshot" ? t("context.snapshotNote") : details?.source === "history" ? t("context.historyNote") : ""].filter(Boolean).join(" ");
  const compactHint = compacting ? t("context.compacting") : busy ? t("context.busy") : details?.canCompact === false ? t("context.branchReadOnly") : details?.autoCompactionEnabled === false ? t("context.autoOff") : details?.autoCompactionEnabled && capacity.available !== null ? t("context.untilAuto", { tokens: formatTokens(capacity.available) }) : t("context.compactHint");
  const completed = !compacting && !busy && controls?.result && controls.result !== resultAtOpen ? controls.result : null;
  const footerText = completed ? t("context.compacted", { tokens: formatTokens(Math.max(0, completed.tokensBefore - completed.estimatedTokensAfter)) }) : compactHint;
  const number = (value: number) => value.toLocaleString(locale);
  const rows = (values: Array<[string, string]>) => <dl className={`${styles.legend} ${styles.statRows}`}>{values.map(([label, value]) => <div key={label} className={styles.legendItem}><dt title={label}>{label}</dt><dd>{value}</dd></div>)}</dl>;

  return <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value === "session" ? "session" : "context")}>
    <Tabs.List className={styles.tabs} aria-label={t("context.title")}>
      <Tabs.Tab value="context" className={styles.tab}>{t("context.tabContext")}</Tabs.Tab>
      <Tabs.Tab value="session" className={styles.tab}>{t("context.tabSession")}</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="context" className={styles.content}>
      <div className={styles.capacityHeading}>
        <LabelTooltip content={note}><span className={styles.capacityLabel} tabIndex={0}>{t("context.tabContext")} <strong>{current.percent === null ? "—" : `${estimated ? "≈" : ""}${current.percent.toFixed(0)}%`}</strong></span></LabelTooltip>
        <span>{estimated ? "≈ " : ""}{formatTokens(current.tokens)} <span className={styles.muted}>/ {current.contextWindow > 0 ? formatTokens(current.contextWindow) : t("context.limitUnknown")}</span></span>
      </div>
      <div className={styles.capacityBar} role="img" aria-label={`${t("context.current")}: ${current.percent === null ? t("context.unknown") : `${current.percent.toFixed(1)}%`}`}>
        {parts.map((part) => <span key={part.id} style={{ flexGrow: part.tokens ?? 0, background: colors[part.id] }} />)}
      </div>
      <div className={styles.legend} aria-label={t("context.estimateNote")}>
        {legend.map((part) => <LabelTooltip key={part.id} content={t(part.id === "free" ? "context.hint.free" : part.id === "reserved" ? "context.reserveHint" : `context.hint.${part.id}`)}>
          <div className={styles.legendItem}><i style={{ background: colors[part.id] }} /><span>{t(`context.category.${part.id}`)}</span><b>{formatTokens(part.tokens)}</b></div>
        </LabelTooltip>)}
      </div>
      {loading && !details && <p className={styles.note} role="status">{t("context.loading")}</p>}
      {error && <p className={styles.error} role="alert">{t("context.loadFailed")} <button type="button" onClick={onRetry}>{t("context.retry")}</button></p>}
      <footer className={styles.compactArea} aria-busy={compacting}>
        <LabelTooltip content={completed ? t("context.compactionEstimate") : compactHint}><span className={styles.compactHint} role={completed ? "status" : undefined}>{compacting && <i className={styles.spinner} />}{footerText}</span></LabelTooltip>
        {compacting ? <button type="button" onClick={() => void controls?.abort()}>{t("context.stop")}</button> : <button type="button" disabled={!canCompact} onClick={() => void controls?.compact()}>{t("context.compact")}</button>}
      </footer>
      {controls?.error && <p className={styles.error} role="alert">{controls.error}</p>}
    </Tabs.Panel>
    <Tabs.Panel value="session" className={styles.content}>
      {stats ? <>
        <LabelTooltip content={t("context.cumulativeNote")}><h3 className={styles.sectionTitle}>{t("context.cumulative")}</h3></LabelTooltip>
        {rows([
          [t("session.input"), number(stats.tokens.input)], [t("session.output"), number(stats.tokens.output)],
          [t("session.cacheRead"), number(stats.tokens.cacheRead)], ...(stats.tokens.cacheWrite > 0 ? [[t("session.cacheWrite"), number(stats.tokens.cacheWrite)] as [string, string]] : []),
          [t("session.total"), number(stats.tokens.total)], [t("session.cost"), `$${stats.cost.toFixed(4)}`],
          ...(stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite > 0 ? [[t("session.cacheHitRate"), `${(stats.tokens.cacheRead / (stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite) * 100).toFixed(1)}%`] as [string, string]] : []),
        ])}
        <section className={styles.messageSection}><h3 className={styles.sectionTitle}>{t("session.messages")}</h3>
          {rows([[t("session.user"), number(stats.userMessages)], [t("session.assistant"), number(stats.assistantMessages)], [t("session.toolCalls"), number(stats.toolCalls)], [t("session.toolResults"), number(stats.toolResults)], [t("session.total"), number(stats.totalMessages)]])}
        </section>
      </> : <p className={styles.note}>{t("session.load")}</p>}
    </Tabs.Panel>
  </Tabs.Root>;
}

export function ContextPopover({ sessionId, leafId, stats, usage, controls, open, onOpenChange }: {
  sessionId: string | null;
  leafId: string | null;
  stats: SessionStatsInfo | null;
  usage: ContextUsage | null;
  controls: ContextControls | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const triggerId = useId();
  const [tab, setTab] = useState<ContextTab>("context");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const cache = useRef<Snapshot | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const activeControls = controls?.sessionId === sessionId ? controls : null;
  const busy = Boolean(activeControls?.busy || activeControls?.isCompacting);
  const requestedLeaf = busy ? null : leafId;
  const requestKey = JSON.stringify([sessionId, requestedLeaf, usage?.tokens, usage?.contextWindow, usage?.percent, usage?.estimated, stats?.tokens.total, activeControls?.isCompacting]);
  const hasLiveUsage = usage?.tokens != null && usage.contextWindow > 0;
  const details = snapshot?.key === requestKey ? snapshot.details : null;

  // One read-only loader serves the ring and both tabs. Tab changes do not fetch.
  useEffect(() => {
    if (!sessionId || (!open && (hasLiveUsage || cache.current?.key === requestKey))) return;
    const controller = new AbortController();
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const query = requestedLeaf ? `?leafId=${encodeURIComponent(requestedLeaf)}` : "";
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-usage${query}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("context unavailable");
        const next = await response.json() as ContextDetails;
        if (controller.signal.aborted || request !== sequence || next.sessionId !== sessionId) return;
        cache.current = { key: requestKey, details: next };
        setSnapshot(cache.current);
        setErrorKey(null);
      } catch {
        if (!controller.signal.aborted && request === sequence) setErrorKey(requestKey);
      }
    };
    void load();
    const timer = open && busy ? setInterval(() => void load(), 10_000) : undefined;
    return () => { controller.abort(); if (timer !== undefined) clearInterval(timer); };
  }, [sessionId, requestedLeaf, requestKey, hasLiveUsage, open, busy, refresh]);

  const displayUsage = details?.usage ?? usage ?? stats?.contextUsage ?? null;
  const tooltip = displayUsage?.percent != null && displayUsage.contextWindow > 0
    ? `${t("context.current")} ${displayUsage.estimated ? "≈" : ""}${displayUsage.percent.toFixed(0)}% · ${formatTokens(displayUsage.tokens)} / ${formatTokens(displayUsage.contextWindow)} tokens`
    : sessionId ? `${t("context.current")} · ${formatTokens(displayUsage?.tokens)} tokens` : t("context.noSession");

  return <Popover.Root open={open && Boolean(sessionId)} triggerId={triggerId} onOpenChange={(value) => { setTab("context"); onOpenChange(value && Boolean(sessionId)); }}>
    <Tooltip disabled={open}>
      <TooltipTrigger render={<Popover.Trigger id={triggerId} disabled={!sessionId} className={styles.trigger} aria-label={t("context.title")} aria-busy={activeControls?.isCompacting || undefined} data-context-trigger><ContextRing usage={displayUsage} /></Popover.Trigger>} />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
    <Popover.Portal>
      <Popover.Positioner side="top" align="end" sideOffset={10} collisionPadding={12} className={styles.positioner}>
        <Popover.Popup className={styles.popup} aria-label={t("context.title")} data-context-popup>
          <Popover.Close className={styles.close} aria-label={t("context.close")}>×</Popover.Close>
          {open && <ContextInspector details={details} usage={displayUsage} stats={stats} controls={activeControls} tab={tab} onTabChange={setTab} loading={!details && errorKey !== requestKey} error={errorKey === requestKey} onRetry={() => setRefresh((value) => value + 1)} />}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
