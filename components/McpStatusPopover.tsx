"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertCircleIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { McpRuntimeStatus, McpServerRuntimeState } from "@/lib/api-types";

const stateColor = (state: McpServerRuntimeState) => state === "connected" ? "#22c55e" : state === "failed" || state === "needs-auth" ? "#ef4444" : state === "cached" ? "#eab308" : "var(--text-dim)";
const actionStyle = { border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", padding: "3px 8px", cursor: "pointer", fontSize: 12 } as const;

export function McpStatusDetails({ status }: { status: McpRuntimeStatus | null }) {
  const { t } = useI18n();
  if (!status) return <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("mcpStatus.noSnapshot")}</p>;
  const disabled = status.servers.filter((server) => server.disabled || server.state === "disabled").length;
  const connected = status.servers.filter((server) => server.state === "connected" && !server.disabled).length;
  const metrics = [
    [t("mcpStatus.enabled"), status.servers.length - disabled],
    [t("mcpStatus.connected"), connected],
    [t("mcpStatus.tools"), status.totalTools],
    [t("mcpStatus.resources"), status.totalResources ?? "—"],
  ];
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
      {metrics.map(([label, count]) => <div key={label} style={{ padding: "8px 4px", border: "1px solid var(--border)", borderRadius: 6, textAlign: "center" }}><strong style={{ display: "block", fontSize: 18, color: "var(--text)" }}>{count}</strong><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span></div>)}
    </div>
    {status.servers.length === 0 && <p style={{ color: "var(--text-muted)" }}>{t("mcpStatus.empty")}</p>}
    <div style={{ display: "grid", gap: 8 }}>
      {status.servers.map((server) => <article key={server.name} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: stateColor(server.disabled ? "disabled" : server.state), flexShrink: 0 }} />
          <strong style={{ minWidth: 0, overflowWrap: "anywhere", flex: 1, fontSize: 12 }}>{server.name}</strong>
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-muted)" }}>{t(`mcpStatus.state.${server.disabled ? "disabled" : server.state}`)}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: "var(--text-muted)" }}>
          <span>{t("mcpStatus.tools")}: {server.toolCount}</span>
          <span>{t("mcpStatus.directTools")}: {server.directToolCount ?? "—"}</span>
          <span>{t("mcpStatus.resources")}: {server.resourceCount ?? "—"}</span>
          {server.listenState && <span>{t("mcpStatus.listen")}: {t(`mcpStatus.listen.${server.listenState}`)}</span>}
          {server.failedAgoSeconds !== undefined && <span>{t("mcpStatus.failureAge", { seconds: server.failedAgoSeconds })}</span>}
        </div>
        {(server.disabled || server.state !== "connected") && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-muted)" }}>{t(`mcpStatus.hint.${server.disabled ? "disabled" : server.state}`)}</p>}
        {server.catalogStale && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#b45309" }}>{t("mcpStatus.catalogStale")}</p>}
      </article>)}
    </div>
  </>;
}

export function McpStatusPopover({ sessionId, children }: { sessionId?: string | null; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<McpRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [refreshFeedback, setRefreshFeedback] = useState<"idle" | "refreshing" | "refreshed" | "failed">("idle");
  const manualRefreshRef = useRef(false);

  useEffect(() => {
    if (refreshFeedback !== "refreshed" && refreshFeedback !== "failed") return;
    const timer = setTimeout(() => setRefreshFeedback("idle"), 1800);
    return () => clearTimeout(timer);
  }, [refreshFeedback]);

  useEffect(() => {
    if (!open || !sessionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (disposed || document.hidden) return;
      const request = new AbortController();
      controller = request;
      setLoading(true);
      try {
        const response = await fetch(`/api/mcp/status?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("status unavailable");
        const payload = await response.json() as { status: McpRuntimeStatus | null };
        if (payload.status && payload.status.sessionId !== sessionId) throw new Error("session mismatch");
        if (!disposed && !request.signal.aborted) {
          setStatus(payload.status); setError(false);
          if (manualRefreshRef.current) { manualRefreshRef.current = false; setRefreshFeedback("refreshed"); }
        }
      } catch {
        if (!disposed && !request.signal.aborted) {
          setStatus(null); setError(true);
          if (manualRefreshRef.current) { manualRefreshRef.current = false; setRefreshFeedback("failed"); }
        }
      } finally {
        if (!disposed && !request.signal.aborted) { setLoading(false); timer = setTimeout(load, 3000); }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void load();
    };
    void load();
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [open, sessionId, refresh]);

  return <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); manualRefreshRef.current = false; setRefreshFeedback("idle"); }}>
    <Popover.Trigger disabled={!sessionId} aria-label={t("mcpStatus.open")} title={t("mcpStatus.open")} style={{ display: "inline-flex", alignItems: "center", border: 0, borderRadius: 4, padding: "3px 4px", margin: "0 -4px", background: "transparent", color: "inherit", font: "inherit", cursor: sessionId ? "pointer" : "default" }}>{children}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" align="start" sideOffset={8} style={{ zIndex: 150 }}>
        <Popover.Popup style={{ width: "min(440px, calc(100vw - 24px))", maxHeight: "min(560px, 75dvh)", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", color: "var(--text)", boxShadow: "var(--shadow-overlay)", fontSize: 12 }}>
          <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <Popover.Title style={{ margin: 0, flex: 1, fontSize: 14, fontWeight: 600 }}>{t("mcpStatus.title")}</Popover.Title>
            <button type="button" style={{ ...actionStyle, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 80, color: refreshFeedback === "refreshed" ? "#16a34a" : refreshFeedback === "failed" ? "#ef4444" : actionStyle.color, cursor: loading ? "default" : "pointer" }} disabled={loading} aria-busy={refreshFeedback === "refreshing"} onClick={() => { manualRefreshRef.current = true; setRefreshFeedback("refreshing"); setRefresh((value) => value + 1); }}>
              {refreshFeedback === "refreshed" ? <CheckIcon size={12} aria-hidden="true" /> : refreshFeedback === "failed" ? <AlertCircleIcon size={12} aria-hidden="true" /> : <RefreshCwIcon size={12} aria-hidden="true" className={refreshFeedback === "refreshing" ? "animate-spin" : undefined} />}
              <span aria-live="polite">{t(refreshFeedback === "refreshing" ? "mcpStatus.refreshing" : refreshFeedback === "refreshed" ? "mcpStatus.refreshed" : refreshFeedback === "failed" ? "mcpStatus.refreshFailed" : "mcpStatus.refresh")}</span>
            </button>
            <Popover.Close aria-label={t("mcpStatus.close")} style={actionStyle}>×</Popover.Close>
          </header>
          <div aria-live="polite" aria-busy={loading} style={{ padding: 14, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
            {error ? <p role="alert" style={{ color: "#ef4444" }}>{t("mcpStatus.loadError")}</p> : loading && !status ? <p>{t("mcpStatus.loading")}</p> : <McpStatusDetails status={status} />}
          </div>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
