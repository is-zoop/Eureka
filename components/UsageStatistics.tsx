"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/hooks/useI18n";
import type { UsageDay, UsageModel, UsageProject, UsageRange, UsageStatistics, UsageTotals } from "@/lib/usage-statistics";

type UsageView = "time" | "projects" | "models";

const ranges: UsageRange[] = ["7d", "30d", "90d", "12m", "all"];

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={expanded ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return <svg className={`mr-1.5 h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 15.5 6.2L21 16" /><path d="M21 21v-5h-5" /></svg>;
}

function formatTokens(value: number, locale: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString(locale);
}

function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | null, locale: string): string {
  return value === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date) : "—";
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, calls: 0, usageCalls: 0, costCalls: 0, sessions: 0, activeDays: 0, toolCalls: 0, cacheHitRate: null };
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4"><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="mt-2 text-xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p></section>;
}

function Coverage({ totals }: { totals: UsageTotals }) {
  const { t, locale } = useI18n();
  if (totals.calls === 0 || (totals.usageCalls === totals.calls && totals.costCalls === totals.calls)) return null;
  const usageCoverage = totals.calls ? totals.usageCalls / totals.calls : 0;
  const costCoverage = totals.calls ? totals.costCalls / totals.calls : 0;
  return <p className="mt-4 text-xs text-[var(--text-muted)]">{t("usage.coverage", { usage: formatPercent(usageCoverage, locale), cost: formatPercent(costCoverage, locale) })}</p>;
}

function Heatmap({ days }: { days: UsageDay[] }) {
  const { t, locale } = useI18n();
  const cells = useMemo(() => {
    const values = new Map(days.map((day) => [day.date, day]));
    const last = new Date();
    last.setHours(0, 0, 0, 0);
    const first = new Date(last);
    first.setMonth(first.getMonth() - 12);
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const result: UsageDay[] = [];
    for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      result.push(values.get(key) ?? { ...emptyTotals(), date: key });
    }
    return result;
  }, [days]);
  const ceiling = Math.max(...cells.map((cell) => cell.total), 1);
  const columns = Math.ceil(cells.length / 7);
  const monthLabels = cells.flatMap((day, index) => {
    const date = new Date(`${day.date}T00:00:00`);
    const previous = index > 0 ? new Date(`${cells[index - 1].date}T00:00:00`) : null;
    if (index === 0 && date.getDate() !== 1) return [];
    if (index !== 0 && previous?.getMonth() === date.getMonth()) return [];
    return [{ column: Math.floor(index / 7) + 1, label: new Intl.DateTimeFormat(locale, { month: "short" }).format(date) }];
  });
  return <div className="overflow-x-auto pb-1"><div className="w-max"><div className="grid gap-1" style={{ gridAutoFlow: "column", gridTemplateRows: "repeat(7, 14px)", gridTemplateColumns: `repeat(${columns}, 14px)` }}>
    {cells.map((day) => {
      const ratio = day.total / ceiling;
      const background = day.total === 0 ? "var(--bg-hover)" : `color-mix(in srgb, var(--accent) ${Math.round(22 + ratio * 78)}%, var(--bg-panel))`;
      const detail = [
        formatDate(`${day.date}T00:00:00`, locale),
        `${t("usage.totalTokens")}: ${formatTokens(day.total, locale)}`,
        `${t("usage.input")}: ${formatTokens(day.input, locale)} · ${t("usage.output")}: ${formatTokens(day.output, locale)}`,
        `${t("usage.cacheRead")}: ${formatTokens(day.cacheRead, locale)}`,
        `${t("usage.recordedCost")}: ${day.costCalls ? formatCost(day.cost, locale) : t("usage.notRecorded")}`,
        `${t("usage.calls")}: ${day.calls.toLocaleString(locale)}`,
        ...(day.topProject ? [`${t("usage.topProject")}: ${day.topProject}`] : []),
        ...(day.topModel ? [`${t("usage.topModel")}: ${day.topModel}`] : []),
      ].join("\n");
      return <Tooltip key={day.date}><TooltipTrigger render={<button type="button" aria-label={detail} className="h-3.5 w-3.5 rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" style={{ background }} />} /><TooltipContent className="whitespace-pre-line">{detail}</TooltipContent></Tooltip>;
    })}
  </div><div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, 14px)` }}>{monthLabels.map((month) => <span key={`${month.column}-${month.label}`} className="whitespace-nowrap text-[11px] text-[var(--text-muted)]" style={{ gridColumnStart: month.column }}>{month.label}</span>)}</div></div></div>;
}

function TokenTrend({ days, range }: { days: UsageDay[]; range: UsageRange }) {
  const { t, locale } = useI18n();
  const values = useMemo(() => {
    const known = new Map(days.map((day) => [day.date, day]));
    const last = new Date();
    last.setHours(0, 0, 0, 0);
    const first = new Date(last);
    if (range === "all") {
      const firstKnown = days[0] ? new Date(`${days[0].date}T00:00:00`) : last;
      first.setTime(firstKnown.getTime());
    } else if (range === "12m") first.setMonth(first.getMonth() - 12);
    else first.setDate(first.getDate() - (Number.parseInt(range, 10) - 1));
    const months = new Map<string, Pick<UsageTotals, "input" | "output" | "cacheRead" | "total" | "cost" | "costCalls" | "calls">>();
    for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
      const dayKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const monthKey = dayKey.slice(0, 7);
      const day = known.get(dayKey);
      const total = months.get(monthKey) ?? { input: 0, output: 0, cacheRead: 0, total: 0, cost: 0, costCalls: 0, calls: 0 };
      if (day) {
        total.input += day.input;
        total.output += day.output;
        total.cacheRead += day.cacheRead;
        total.total += day.total;
        total.cost += day.cost;
        total.costCalls += day.costCalls;
        total.calls += day.calls;
      }
      months.set(monthKey, total);
    }
    return [...months.entries()].map(([month, totals]) => ({ month, ...totals }));
  }, [days, range]);
  const ceiling = Math.max(...values.map((value) => value.total), 1);
  if (!values.length) return null;
  return <div className="mt-7"><div className="overflow-x-auto pb-1"><div className="flex min-w-max items-end gap-2 border-b border-[var(--border)] pt-3" style={{ minWidth: Math.max(260, values.length * 48) }} role="img" aria-label={t("usage.tokenTrend")}>
    {values.map((value) => { const label = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(`${value.month}-01T00:00:00`)); const detail = <div className="min-w-44 space-y-1"><p className="font-medium">{label}</p><div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-muted)]"><span>{t("usage.totalTokens")}</span><span className="text-right tabular-nums text-[var(--text)]">{formatTokens(value.total, locale)}</span><span>{t("usage.input")}</span><span className="text-right tabular-nums text-[var(--text)]">{formatTokens(value.input, locale)}</span><span>{t("usage.output")}</span><span className="text-right tabular-nums text-[var(--text)]">{formatTokens(value.output, locale)}</span><span>{t("usage.cacheRead")}</span><span className="text-right tabular-nums text-[var(--text)]">{formatTokens(value.cacheRead, locale)}</span><span>{t("usage.recordedCost")}</span><span className="text-right tabular-nums text-[var(--text)]">{value.costCalls ? formatCost(value.cost, locale) : t("usage.notRecorded")}</span><span>{t("usage.calls")}</span><span className="text-right tabular-nums text-[var(--text)]">{value.calls.toLocaleString(locale)}</span></div></div>; return <Tooltip key={value.month}><TooltipTrigger render={<button type="button" aria-label={`${label}: ${formatTokens(value.total, locale)}`} className="group flex h-28 w-10 items-end justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><span className="w-6 rounded-t-sm bg-[var(--accent)] opacity-85 transition-opacity group-hover:opacity-100" style={{ height: `${value.total ? Math.max(4, value.total / ceiling * 100) : 0}%` }} /></button>} /><TooltipContent>{detail}</TooltipContent></Tooltip>; })}
  </div><div className="flex min-w-max gap-2" style={{ minWidth: Math.max(260, values.length * 48) }}>{values.map((value) => <span key={value.month} className="w-10 text-center text-[11px] text-[var(--text-muted)]">{new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(`${value.month}-01T00:00:00`))}</span>)}</div></div></div>;
}

function ProjectRows({ projects }: { projects: UsageProject[] }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-[var(--border)] text-left text-xs font-normal text-[var(--text-muted)]"><tr><th className="px-3 py-2 font-normal">{t("usage.project")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.totalTokens")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.recordedCost")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.calls")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.lastUsed")}</th></tr></thead><tbody>
    {projects.map((project) => <ProjectRow key={project.id} project={project} expanded={expanded === project.id} onToggle={() => setExpanded((current) => current === project.id ? null : project.id)} />)}
  </tbody></table></div>;
}

function ProjectRow({ project, expanded, onToggle }: { project: UsageProject; expanded: boolean; onToggle: () => void }) {
  const { t, locale } = useI18n();
  return <><tr className="border-b border-[var(--border)]"><td className="px-3 py-3"><button type="button" onClick={onToggle} className="inline-flex max-w-72 items-center gap-1.5 truncate font-medium hover:text-[var(--accent)]" aria-expanded={expanded}><ChevronIcon expanded={expanded} /><span className="truncate">{project.name}</span></button></td><td className="px-3 py-3 text-right tabular-nums">{formatTokens(project.total, locale)}</td><td className="px-3 py-3 text-right tabular-nums">{project.costCalls ? formatCost(project.cost, locale) : t("usage.notRecorded")}</td><td className="px-3 py-3 text-right tabular-nums">{project.calls.toLocaleString(locale)}</td><td className="px-3 py-3 text-right text-xs text-[var(--text-muted)]">{formatDate(project.lastUsed, locale)}</td></tr>
    {expanded && project.models.map((model) => <tr key={`${model.provider}/${model.model}`} className="border-b border-[var(--border)] bg-[var(--bg-hover)]"><td className="px-3 py-2 pl-10"><span className="font-medium">{model.model}</span><span className="ml-2 text-[var(--text-muted)]">{model.provider}</span></td><td className="px-3 py-2 text-right tabular-nums">{formatTokens(model.total, locale)}</td><td className="px-3 py-2 text-right tabular-nums">{model.costCalls ? formatCost(model.cost, locale) : t("usage.notRecorded")}</td><td className="px-3 py-2 text-right tabular-nums">{model.calls.toLocaleString(locale)}</td><td className="px-3 py-2 text-right text-[var(--text-muted)]">{formatDate(model.lastUsed, locale)}</td></tr>)}
  </>;
}

function ProviderRows({ providers }: { providers: UsageStatistics["providers"] }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-[var(--border)] text-left text-xs font-normal text-[var(--text-muted)]"><tr><th className="px-3 py-2 font-normal">{t("usage.providerModel")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.totalTokens")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.recordedCost")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.cacheHitRate")}</th><th className="px-3 py-2 text-right font-normal">{t("usage.calls")}</th></tr></thead><tbody>
    {providers.map((provider) => <Fragment key={provider.provider}><tr className="border-b border-[var(--border)]"><td className="px-3 py-3"><button type="button" onClick={() => setExpanded((current) => current === provider.provider ? null : provider.provider)} className="inline-flex max-w-72 items-center gap-1.5 truncate font-medium hover:text-[var(--accent)]" aria-expanded={expanded === provider.provider}><ChevronIcon expanded={expanded === provider.provider} /><span className="truncate">{provider.provider}</span></button></td><td className="px-3 py-3 text-right tabular-nums">{formatTokens(provider.total, locale)}</td><td className="px-3 py-3 text-right tabular-nums">{provider.costCalls ? formatCost(provider.cost, locale) : t("usage.notRecorded")}</td><td className="px-3 py-3 text-right tabular-nums">{formatPercent(provider.cacheHitRate, locale)}</td><td className="px-3 py-3 text-right tabular-nums">{provider.calls.toLocaleString(locale)}</td></tr>
      {expanded === provider.provider && provider.models.map((model) => <ModelRow key={`${provider.provider}/${model.model}`} model={model} />)}
    </Fragment>)}
  </tbody></table></div>;
}

function ModelRow({ model }: { model: UsageModel }) {
  const { t, locale } = useI18n();
  return <tr className="border-b border-[var(--border)] bg-[var(--bg-hover)]"><td className="px-3 py-2 pl-10 font-medium">{model.model}</td><td className="px-3 py-2 text-right tabular-nums">{formatTokens(model.total, locale)}</td><td className="px-3 py-2 text-right tabular-nums">{model.costCalls ? formatCost(model.cost, locale) : t("usage.notRecorded")}</td><td className="px-3 py-2 text-right tabular-nums">{formatPercent(model.cacheHitRate, locale)}</td><td className="px-3 py-2 text-right tabular-nums">{model.calls.toLocaleString(locale)}</td></tr>;
}

export function UsageStatisticsPage() {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<UsageRange>("12m");
  const [view, setView] = useState<UsageView>("time");
  const [data, setData] = useState<UsageStatistics | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async (refresh = false) => {
    setState("loading");
    try {
      const response = await fetch(`/api/usage-statistics?range=${range}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("usage statistics unavailable");
      setData(await response.json() as UsageStatistics);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  const totals = data?.totals ?? emptyTotals();
  return <TooltipProvider><div className="mx-auto w-full max-w-6xl px-8 py-12 max-sm:px-5 max-sm:py-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-[-0.02em]">{t("usage.title")}</h1><p className="mt-2 text-sm text-[var(--text-muted)]">{t("usage.description")}</p></div><Button variant="outline" size="sm" onClick={() => void load(true)} disabled={state === "loading"}><RefreshIcon spinning={state === "loading"} />{t("usage.refresh")}</Button></div>
    <div className="mt-6 flex flex-wrap gap-1" role="group" aria-label={t("usage.range")}>
      {ranges.map((item) => <button key={item} type="button" onClick={() => setRange(item)} className="h-8 rounded-[var(--radius-control)] px-3 text-xs font-medium transition-colors" style={{ background: range === item ? "var(--bg-selected)" : "transparent", color: "var(--text)" }}>{t(`usage.range.${item}`)}</button>)}
    </div>
    {state === "error" ? <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--danger)]/30 bg-[var(--danger-hover)] p-4 text-sm text-[var(--danger)]">{t("usage.loadFailed")}</div> : <>
      <div className="mt-7 grid gap-3 sm:grid-cols-3"><Metric label={t("usage.totalTokens")} value={formatTokens(totals.total, locale)} detail={`${t("usage.activeDays")}: ${totals.activeDays.toLocaleString(locale)}`} /><Metric label={t("usage.recordedCost")} value={totals.costCalls ? formatCost(totals.cost, locale) : t("usage.notRecorded")} detail={`${t("usage.costCalls")}: ${totals.costCalls.toLocaleString(locale)}`} /><Metric label={t("usage.calls")} value={totals.calls.toLocaleString(locale)} detail={`${t("usage.sessions")}: ${totals.sessions.toLocaleString(locale)}`} /></div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--text-muted)]"><span>{t("usage.toolCalls")}: {totals.toolCalls.toLocaleString(locale)}</span><span>{t("usage.cacheHitRate")}: {formatPercent(totals.cacheHitRate, locale)}</span><span>{t("usage.input")}: {formatTokens(totals.input, locale)}</span><span>{t("usage.output")}: {formatTokens(totals.output, locale)}</span></div>
      <Coverage totals={totals} />
      <Tabs value={view} onValueChange={(value) => setView(value as UsageView)} className="mt-8"><TabsList className="max-w-full overflow-x-auto"><TabsTrigger value="time">{t("usage.byTime")}</TabsTrigger><TabsTrigger value="projects">{t("usage.byProject")}</TabsTrigger><TabsTrigger value="models">{t("usage.byProviderModel")}</TabsTrigger></TabsList>
        <TabsContent value="time" className="mt-5"><section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-5"><h2 className="text-base font-semibold">{t("usage.tokenActivity")}</h2>{state === "loading" ? <div className="mt-5 h-28 animate-pulse rounded-[var(--radius-control)] bg-[var(--bg-hover)]" /> : data && data.days.length ? <><div className="mt-5"><Heatmap days={data.days} /></div><TokenTrend days={data.trendDays} range={range} /></> : <p className="py-12 text-center text-sm text-[var(--text-muted)]">{t("usage.empty")}</p>}</section></TabsContent>
        <TabsContent value="projects" className="mt-5"><section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-2"><div className="px-3 pb-3 pt-2"><h2 className="text-base font-semibold">{t("usage.projectUsage")}</h2></div>{state === "loading" ? <div className="h-36 animate-pulse bg-[var(--bg-hover)]" /> : data?.projects.length ? <ProjectRows projects={data.projects} /> : <p className="py-12 text-center text-sm text-[var(--text-muted)]">{t("usage.empty")}</p>}</section></TabsContent>
        <TabsContent value="models" className="mt-5"><section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-2"><div className="px-3 pb-3 pt-2"><h2 className="text-base font-semibold">{t("usage.providerModelUsage")}</h2></div>{state === "loading" ? <div className="h-36 animate-pulse bg-[var(--bg-hover)]" /> : data?.providers.length ? <ProviderRows providers={data.providers} /> : <p className="py-12 text-center text-sm text-[var(--text-muted)]">{t("usage.empty")}</p>}</section></TabsContent>
      </Tabs>
    </>}</div></TooltipProvider>;
}
