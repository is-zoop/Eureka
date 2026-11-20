"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutomationSchedules } from "../../automation/ui/AutomationSchedules";
import { BrowserSettings } from "./BrowserSettings";
import { AutomationPublicationAiSettings } from "../../automation/ui/AutomationPublicationAiSettings";
import { RefreshCwIcon } from "lucide-react";
import type { AutomationAppIndex } from "@/features/automation/shared/automation-app";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "../../../components/ui/button";
import { RemovalDialog } from "../../extensions/ui/RemovalDialog";
import { SettingsCard, SettingsLayout, SettingsRow, SettingsSection } from "../../../components/SettingsLayout";
import { appCredentialCommand } from "@/features/automation/runtime/automation-app-secrets";

type Target = { id: string; name: string; ownerKey: string; runtimeId: string };

export function AutomationSettings() {
  const { t } = useI18n();
  const [index, setIndex] = useState<AutomationAppIndex | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [target, setTarget] = useState<Target | null>(null);
  const retainedList = useRef<HTMLDivElement>(null);
  const [retainedHeight, setRetainedHeight] = useState(370);
  const alive = useRef(false), operation = useRef(false), sequence = useRef(0);
  const message = useCallback((cause: unknown) => cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : t("automationSettings.requestFailed"), [t]);
  const load = useCallback(async () => {
    if (operation.current) return;
    const token = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch("/api/automation/apps", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error(response.status === 401 ? t("automationSettings.signIn") : data.error ?? t("automationSettings.requestFailed"));
      if (typeof data.ownerKey !== "string" || typeof data.runtimeId !== "string" || !Array.isArray(data.data) || !Array.isArray(data.apps)) throw new Error(t("automationSettings.requestFailed"));
      if (alive.current && token === sequence.current) {
        setIndex(data);
        setTarget(previous => previous && (previous.ownerKey !== data.ownerKey || previous.runtimeId !== data.runtimeId || !data.data.some((item: { id: string; installed: boolean }) => item.id === previous.id && !item.installed)) ? null : previous);
      }
    } catch (cause) { if (alive.current && token === sequence.current) { setIndex(null); setTarget(null); setError(message(cause)); } }
    finally { if (alive.current && token === sequence.current) setLoading(false); }
  }, [message, t]);
  useEffect(() => {
    alive.current = true; void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    return () => { alive.current = false; ++sequence.current; window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => {
    const list = retainedList.current; if (!list) return;
    const rows = Array.from(list.children).slice(0, 5);
    const measure = () => { const height = rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0); if (height) setRetainedHeight(Math.ceil(height)); };
    const observer = new ResizeObserver(measure); rows.forEach(row => observer.observe(row)); measure();
    return () => observer.disconnect();
  }, [index, loading]);
  async function clearData() {
    if (!target || !index || operation.current || loading || target.ownerKey !== index.ownerKey || target.runtimeId !== index.runtimeId) return false;
    operation.current = true; ++sequence.current; setBusy(true); setError("");
    let cleared = false;
    try {
      await appCredentialCommand(target.ownerKey, target.id, "clear");
      const response = await fetch("/api/automation/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear-data", id: target.id, confirmAppId: target.id, revision: 0, ownerKey: target.ownerKey, runtimeId: target.runtimeId }), signal: AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t("automationSettings.requestFailed"));
      cleared = true;
      if (alive.current) { setTarget(null); setIndex(previous => previous ? { ...previous, data: previous.data.filter(item => item.id !== target.id) } : previous); }
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { operation.current = false; if (alive.current) { setBusy(false); if (cleared) void load(); } }
    return cleared;
  }
  const retained = index?.data.filter(item => !item.installed) ?? [];
  return <SettingsLayout title={t("settings.automation")} description={t("automationSettings.description")} actions={<Button variant="outline" size="icon" disabled={loading || busy} onClick={() => void load()} aria-label={t("automationSettings.refresh")}><RefreshCwIcon size={15} /></Button>}>
    {error && !target && <p role="alert" className="m-0 text-sm text-[var(--danger,#b42318)]">{error}</p>}
    <AutomationPublicationAiSettings />
    <BrowserSettings embedded />
    {index && <SettingsSection title={t("automationSchedule.title")} description={t("automationSchedule.manageHint")}><SettingsCard className="px-4"><AutomationSchedules index={index}/></SettingsCard></SettingsSection>}
    <SettingsSection title={t("automationSettings.retained")} description={t("automationSettings.retainedDescription")} meta={index ? retained.length : undefined}>
      <SettingsCard>
      <div ref={retainedList} className="divide-y divide-[var(--border)] overflow-y-auto overscroll-contain [&>div]:mx-4" style={{ maxHeight: retainedHeight }} role="region" aria-label={t("automationSettings.retained")} tabIndex={retained.length > 5 ? 0 : undefined}>
        {loading && !index ? <p role="status" className="py-4 text-[13px] text-[var(--text-muted)]">{t("automationSettings.loading")}</p> : retained.length ? retained.map(item => <SettingsRow key={item.id} label={item.displayName} description={t("automationSettings.uninstalled")}><Button variant="destructive" size="sm" disabled={loading || busy} onClick={() => { setError(""); setTarget({ id: item.id, name: item.displayName, ownerKey: index!.ownerKey, runtimeId: index!.runtimeId }); }}>{t("automationSettings.clear")}</Button></SettingsRow>) : index && <SettingsRow label={t("automationSettings.empty")} description={t("automationSettings.emptyDescription")}><span /></SettingsRow>}
      </div>
      </SettingsCard>
    </SettingsSection>
<RemovalDialog open={Boolean(target)} name={target?.name ?? ""} mode="clear-data" busy={busy || loading} error={error} onClose={() => { if (!operation.current) { setTarget(null); setError(""); } }} onConfirm={() => clearData()} />
  </SettingsLayout>;
}
