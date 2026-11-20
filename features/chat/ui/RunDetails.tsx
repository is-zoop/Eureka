"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { RunObservability } from "@/server/agent/run-observability";
type Snapshot = { observations?: RunObservability; cacheWarming?: { mode: string; usage?: { count: number; total: number }; status?: { state: string; reason?: string; nextWarmAt?: number } } };
const channels = new Map<string, { listeners: Set<(value: Snapshot) => void>; value: Snapshot; stop: () => void }>();
function useRun(id?: string, active = true) {
  const [value, setValue] = useState<Snapshot>({});
  useEffect(() => {
    if (!id || !active) return;
    let channel = channels.get(id);
    if (!channel) {
      const controller = new AbortController(); let reading = false;
      const created = { listeners: new Set<(value: Snapshot) => void>(), value: {} as Snapshot, stop: () => { clearInterval(timer); controller.abort(); } };
      const read = async () => { if (reading || document.visibilityState === "hidden") return; reading = true; try { const r = await fetch(`/api/agent/${encodeURIComponent(id)}?observations=1`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" }); if (!r.ok) return; const result = await r.json(); if (!controller.signal.aborted) { created.value = result.state ?? {}; created.listeners.forEach(listener => listener(created.value)); } } catch {} finally { reading = false; } };
      const timer = setInterval(() => void read(), 1000); channel = created; channels.set(id, channel); void read();
    }
    channel.listeners.add(setValue); setValue(channel.value);
    return () => { channel.listeners.delete(setValue); if (!channel.listeners.size) { channel.stop(); channels.delete(id); } };
  }, [id, active]);
  return value;
}
export function ToolProgress({ sessionId, toolCallId, active }: { sessionId?: string; toolCallId: string; active: boolean }) {
  const { t } = useI18n(); const data = useRun(sessionId, active).observations?.tools[toolCallId];
  if (!active || !data) return null;
  return <details className="ml-6 text-xs text-[var(--text-muted)]"><summary>{t("sdk.progress")} · {data.text || data.updates}</summary><p>{new Date(data.at).toLocaleTimeString()}</p></details>;
}
export function RequestDiagnostics({ sessionId, active }: { sessionId?: string; active: boolean }) {
  const { t } = useI18n(); const data = useRun(sessionId, active).observations?.requests;
  if (!data?.length) return null;
  const ms = (n?: number) => n === undefined ? "—" : `${(n / 1000).toFixed(2)} s`;
  return <details className="my-2 text-xs text-[var(--text-muted)]"><summary>{t("sdk.diagnostics")} · {data.length}</summary><p className="my-2">{t("sdk.streamNote")}</p><div className="overflow-x-auto"><table className="w-full text-left tabular-nums"><thead><tr><th>#</th><th>{t("sdk.first")}</th><th>{t("sdk.duration")}</th><th>{t("sdk.retries")}</th></tr></thead><tbody>{data.map((r, i) => <tr key={r.startedAt + ":" + i}><td>{i + 1}</td><td>{ms(r.firstEventMs)}</td><td>{ms(r.durationMs)}</td><td>{r.retries}</td></tr>)}</tbody></table></div></details>;
}
export function CacheWarmingStatus({ sessionId }: { sessionId?: string }) {
  const { t } = useI18n(); const data = useRun(sessionId).cacheWarming;
  if (!data) return null;
  return <section className="mt-3 border-t border-[var(--border)] pt-3 text-xs"><div className="flex justify-between gap-3"><span>{t("sdk.cache")}</span><span>{t(`sdk.${data.mode}`)}</span></div><p className="mt-2 text-[var(--text-muted)]">{data.mode === "off" ? t("sdk.off") : t(`sdk.${data.status?.state ?? "inactive"}`)}{data.status?.nextWarmAt ? ` · ${new Date(data.status.nextWarmAt).toLocaleTimeString()}` : ""}</p>{data.status?.reason && <p className="mt-1 text-[var(--text-muted)]">{data.status.reason}</p>}{Boolean(data.usage?.count) && <p className="mt-2 text-[var(--text-muted)]">{data.usage!.count} · ${data.usage!.total.toFixed(4)}</p>}</section>;
}
