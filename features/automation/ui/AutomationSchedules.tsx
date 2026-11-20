"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AutomationAppDetail, AutomationAppIndex } from "@/features/automation/shared/automation-app";
import type { AppJson } from "@/features/automation/runtime/automation-app-run";
import type { AppSchedule, ScheduleTiming } from "@/features/automation/shared/automation-schedule";
import { relativeAppDate, type RelativeDate } from "@/features/automation/shared/automation-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { LabelTooltip } from "../../workspace/ui/LabelTooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = AppSchedule & { run?: { id: string; status: string; waiting: boolean; error?: string } };
export function AutomationSchedules({ index, detail, getValues, disabled = false }: { index: Pick<AutomationAppIndex, "ownerKey" | "runtimeId">; detail?: AutomationAppDetail; getValues?: () => Record<string, AppJson>; disabled?: boolean }) {
  const { t, locale } = useI18n(), [plans, setPlans] = useState<Plan[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [reload, setReload] = useState(0);
  const [kind, setKind] = useState<ScheduleTiming["kind"]>("daily"), [time, setTime] = useState("09:00"), [day, setDay] = useState(() => relativeAppDate("tomorrow")), [minutes, setMinutes] = useState(60), [days, setDays] = useState([1]);
  const [dates, setDates] = useState<Partial<Record<string, RelativeDate>>>(() => Object.fromEntries((detail?.ui.fields ?? []).filter(f => f.type === "date" && f.default && typeof f.default === "object" && "relative" in f.default).map(f => [f.id, (f.default as { relative: RelativeDate }).relative])));
  const endpoint = "/api/automation/schedules", appId = detail?.install.id;
  useEffect(() => {
    const controller = new AbortController(); let reading = false;
    const load = async () => { if (reading || document.visibilityState === "hidden") return; reading = true; try { const response = await fetch(`${endpoint}${appId ? `?appId=${appId}` : ""}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!controller.signal.aborted) { setPlans(result.plans); setLoaded(true); } } catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); } finally { reading = false; } };
    void load(); const timer = setInterval(() => void load(), 15000); return () => { clearInterval(timer); controller.abort(); };
  }, [appId, reload, index.ownerKey, index.runtimeId]);
  async function post(action: string, extra: Record<string, unknown>) {
    setBusy(true); setError(""); try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ownerKey: index.ownerKey, runtimeId: index.runtimeId, ...extra }), signal: AbortSignal.timeout(30000) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setReload(n => n + 1); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    if (!detail || !getValues) return; try {
      const timing: ScheduleTiming = kind === "once" ? { kind, at: new Date(`${day}T${time}:00`).toISOString() } : kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, time, days } : { kind, minutes };
      await post("create", { plan: { appId: detail.install.id, version: detail.manifest.version, actionId: detail.actionId ?? detail.ui.buttons[0]?.id, values: getValues(), dates, timing } });
    } catch (cause) { setError((cause as Error).message); }
  }
  const locked = disabled || busy || !loaded;
  const kinds = ["once", "daily", "weekly", "interval"].map(value => ({ value, label: t(`automationSchedule.${value}`) }));
  const dateItems = ["fixed", "today", "yesterday", "tomorrow"].map(value => ({ value, label: t(`automationSchedule.${value}`) }));
  const status = (value: string) => t(`automationSchedule.status.${value}`);
  const timingLabel = (p: AppSchedule) => p.timing.kind === "once" ? new Date(p.timing.at).toLocaleString(locale) : p.timing.kind === "interval" ? `${t("automationSchedule.interval")} · ${p.timing.minutes} ${t("automationSchedule.minutes")}` : `${t(`automationSchedule.${p.timing.kind}`)} ${p.timing.time}${p.timing.kind === "weekly" ? ` · ${p.timing.days.map(d => t(`automationSchedule.day.${d}`)).join("、")}` : ""}`;
  return <div className="space-y-4 py-3">
    {detail && <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-32 flex-1 flex-col gap-2">
          <label htmlFor="schedule-frequency">{t("automationSchedule.frequency")}</label>
          <Select items={kinds} value={kind} disabled={locked} onValueChange={value => { if (value) setKind(value as ScheduleTiming["kind"]); }}><SelectTrigger id="schedule-frequency"><SelectValue/></SelectTrigger><SelectContent>{kinds.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
        </div>
        {kind === "once" && <div className="flex min-w-36 flex-1 flex-col gap-2"><label htmlFor="schedule-date">{t("automationSchedule.date")}</label><DatePicker id="schedule-date" calendarLabel={t("automationSchedule.date")} value={day} onValueChange={setDay} disabled={locked}/></div>}
        {kind !== "interval" ? <div className="flex min-w-32 flex-1 flex-col gap-2"><label htmlFor="schedule-time">{t("automationSchedule.time")}</label><TimePicker id="schedule-time" value={time} disabled={locked} onValueChange={setTime}/></div> : <label className="flex min-w-32 flex-1 flex-col gap-2">{t("automationSchedule.minutes")}<Input type="number" min={1} max={10080} value={minutes} disabled={locked} onChange={e => setMinutes(Number(e.target.value))}/></label>}
        <Button className="ml-auto shrink-0" disabled={locked} onClick={() => void create()}>{t("automationSchedule.create")}</Button>
      </div>
      {kind === "weekly" && <div className="flex flex-wrap gap-3">{[1,2,3,4,5,6,0].map(d => <label key={d} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={days.includes(d)} disabled={locked} onChange={e => setDays(old => e.target.checked ? [...old,d] : old.filter(v => v !== d))}/>{t(`automationSchedule.day.${d}`)}</label>)}</div>}
      {detail.ui.fields.some(f => f.type === "date") && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{detail.ui.fields.filter(f => f.type === "date").map(field => <div key={field.id} className="flex min-w-0 flex-col gap-2 text-sm"><label htmlFor={`schedule-field-${field.id}`}>{field.label}</label><Select items={dateItems} value={dates[field.id] ?? "fixed"} disabled={locked} onValueChange={value => { if (!value) return; setDates(old => { const next = { ...old }; if (value === "fixed") delete next[field.id]; else next[field.id] = value as RelativeDate; return next; }); }}><SelectTrigger id={`schedule-field-${field.id}`}><SelectValue/></SelectTrigger><SelectContent>{dateItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>)}</div>}
    </div>}
    {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
    <div role="region" aria-label={t("automationSchedule.title")} tabIndex={0} className="max-h-64 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--border)]">
      <div className="divide-y divide-[var(--border)]">{plans.map(plan => {
        const last = plan.history[0];
        const next = `${t("automationSchedule.next")}：${plan.nextAt ? new Date(plan.nextAt).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—"}`;
        const information = [plan.timeZone,
          last && `${t("automationSchedule.last")}：${new Date(last.at).toLocaleString(locale)} · ${status(last.status)}${last.message ? ` · ${last.message}` : ""}`,
          plan.run && `${t("automationSchedule.run")}：${status(plan.run.status)}${plan.run.waiting ? ` · ${t("automationSchedule.openApp")}` : ""}${plan.run.error ? ` · ${plan.run.error}` : ""}`,
        ].filter(Boolean).join("\n");
        return <div key={plan.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <LabelTooltip content={information} contentClassName="whitespace-pre-line"><span tabIndex={0} className={`shrink-0 whitespace-nowrap rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium ${plan.enabled ? "bg-[var(--status-success-bg)] text-[var(--status-success)]" : "bg-[var(--danger-hover)] text-[var(--danger)]"}`}>{t(plan.enabled ? "automationSchedule.enabled" : "automationSchedule.paused")}</span></LabelTooltip>
          <div className="flex min-w-0 items-center gap-3 text-xs">
            {!detail && <LabelTooltip content={`${plan.appName} · ${plan.actionLabel}`}><span className="max-w-28 truncate">{plan.appName}</span></LabelTooltip>}
            <LabelTooltip content={timingLabel(plan)}><span className="max-w-1/2 shrink-0 truncate">{timingLabel(plan)}</span></LabelTooltip>
            <LabelTooltip content={next}><span className="min-w-0 truncate text-[var(--text-muted)]">{next}</span></LabelTooltip>
            {plan.run && (plan.run.waiting || ["starting", "running", "failed"].includes(plan.run.status)) && <LabelTooltip content={information} contentClassName="whitespace-pre-line"><span tabIndex={0} className="max-w-24 shrink-0 truncate text-[var(--text-muted)]">{status(plan.run.status)}</span></LabelTooltip>}
          </div>
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-1"><Button size="sm" variant="outline" disabled={locked} onClick={() => void post(plan.enabled ? "pause" : "enable", { id: plan.id, revision: plan.revision })}>{t(plan.enabled ? "automationSchedule.pause" : "automationSchedule.enable")}</Button><Button size="sm" variant="destructive" disabled={locked} onClick={() => void post("delete", { id: plan.id, revision: plan.revision })}>{t("automationSchedule.delete")}</Button></div>
        </div>;
      })}</div>
      {loaded && !plans.length && <p className="px-3 py-4 text-xs text-[var(--text-muted)]">{t("automationSchedule.empty")}</p>}
    </div>
  </div>;
}
