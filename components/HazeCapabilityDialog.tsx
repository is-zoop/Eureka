"use client";

import { useEffect, useState } from "react";
import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { NotificationNotice } from "./Notifications";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { useI18n } from "@/hooks/useI18n";

export type InstallScope = "project" | "global";
export type McpRuntimeOptions = { lifecycle: "lazy" | "eager" | "keep-alive"; idleTimeout: number };

function DialogFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div role="presentation" className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-soft)]"><header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><h2 className="text-base font-semibold text-[var(--text)]">{title}</h2><button type="button" aria-label={t("common.close")} onClick={onClose} className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">×</button></header>{children}</section></div>;
}

function RuntimeFields({ value, onChange }: { value: McpRuntimeOptions; onChange: (value: McpRuntimeOptions) => void }) {
  const { t } = useI18n();
  const lifecycleOptions: Array<{ value: McpRuntimeOptions["lifecycle"]; label: string; note: string }> = [{ value: "lazy", label: "Lazy", note: t("extensions.lifecycle.lazy") }, { value: "eager", label: "Eager", note: t("extensions.lifecycle.eager") }, { value: "keep-alive", label: "Keep alive", note: t("extensions.lifecycle.keepAlive") }];
  return <div className="space-y-4"><div><p className="text-sm font-medium text-[var(--text)]">{t("extensions.lifecycle")}</p><RadioGroup aria-label={t("extensions.lifecycle")} value={value.lifecycle} onValueChange={(lifecycle) => onChange({ ...value, lifecycle: lifecycle as McpRuntimeOptions["lifecycle"] })} className="mt-2 grid gap-1.5">{lifecycleOptions.map((option) => <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 transition-colors ${value.lifecycle === option.value ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"}`}><RadioGroupItem value={option.value} aria-label={option.label} /><span className="shrink-0 text-sm font-medium text-[var(--text)]">{option.label}</span><span className="min-w-0 truncate whitespace-nowrap text-xs text-[var(--text-muted)]">{option.note}</span></label>)}</RadioGroup></div><label className="block"><span className="text-sm font-medium text-[var(--text)]">{t("extensions.idleTimeout")}</span><input type="number" min="1" max="1440" value={value.idleTimeout} onChange={(event) => onChange({ ...value, idleTimeout: Number(event.target.value) })} className="mt-2 h-9 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--text)] outline-none focus:border-[#b8b7b7]" /><span className="mt-1 block text-xs text-[var(--text-muted)]">{t("extensions.idleTimeoutHint")}</span></label></div>;
}

function validOptions(value: McpRuntimeOptions) { return Number.isFinite(value.idleTimeout) && value.idleTimeout >= 1 && value.idleTimeout <= 1440; }

function ScopeIcon({ scope }: { scope: InstallScope }) {
  return scope === "project"
    ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6A2.5 2.5 0 0 1 20.5 8.5v8A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.6 8.7 8.6 12s1.2 6.2 3.4 8.5" /></svg>;
}

type ScopeAvailability = Record<InstallScope, boolean>;

export function HazeCapabilityInstallDialog({ item, cwd, busy, onClose, onConfirm }: { item: OrganizationExtensionDetailItem; cwd: string; busy: boolean; onClose: () => void; onConfirm: (scope: InstallScope, runtime?: McpRuntimeOptions) => Promise<boolean> }) {
  const { t } = useI18n();
  const [scope, setScope] = useState<InstallScope>("project");
  const [runtime, setRuntime] = useState<McpRuntimeOptions>({ lifecycle: "lazy", idleTimeout: 10 });
  const [projectTrusted, setProjectTrusted] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<ScopeAvailability>({ project: false, global: false });
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    let active = true;
    setScope("project"); setRuntime({ lifecycle: "lazy", idleTimeout: 10 }); setError(null); setCompleted(false); setInstalled({ project: false, global: false }); setProjectTrusted(null);
    void Promise.all([
      fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json().catch(() => null) as { trusted?: boolean } | null })),
      fetch(`/api/organization-extensions/${item.id}/installation?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json().catch(() => null) as { project?: Array<{ capabilityId?: string | number }>; global?: Array<{ capabilityId?: string | number }> } | null })),
    ]).then(([trust, installations]) => {
      if (!active) return;
      const trusted = trust.response.ok && trust.payload?.trusted === true;
      const capabilityId = String(item.id);
      const isInstalled = (records: Array<{ capabilityId?: string | number }> | undefined) => records?.some((record) => String(record.capabilityId) === capabilityId) === true;
      const nextInstalled = { project: installations.response.ok && isInstalled(installations.payload?.project), global: installations.response.ok && isInstalled(installations.payload?.global) };
      setProjectTrusted(trusted); setInstalled(nextInstalled);
      if (nextInstalled.project || !trusted) { if (!nextInstalled.global) setScope("global"); }
      else setScope("project");
    }).catch(() => { if (active) setProjectTrusted(false); });
    return () => { active = false; };
  }, [cwd, item.id]);
  const projectUnavailable = installed.project || projectTrusted === false;
  const globalUnavailable = installed.global;
  const selectedUnavailable = scope === "project" ? projectUnavailable : globalUnavailable;
  const noInstallableScope = projectUnavailable && globalUnavailable;
  const submit = async () => { if (selectedUnavailable) return; if (item.type === "MCP" && !validOptions(runtime)) { setError(t("extensions.invalidIdleTimeout")); return; } setError(null); const success = await onConfirm(scope, item.type === "MCP" ? runtime : undefined); if (success) { setCompleted(true); await new Promise<void>((resolve) => window.setTimeout(resolve, 650)); setCompleted(false); } };
  const scopeOptions: Array<{ value: InstallScope; title: string; note: string }> = [{ value: "project", title: t("extensions.project"), note: t("extensions.projectInstallNote") }, { value: "global", title: t("extensions.global"), note: t("extensions.globalInstallNote") }];
  return <DialogFrame title={t("extensions.installDialogTitle", { name: item.name })} onClose={busy || completed ? () => undefined : onClose}><div className="space-y-5 p-5"><div><p className="text-sm font-medium text-[var(--text)]">{t("extensions.installScope")}</p><RadioGroup aria-label={t("extensions.installScope")} value={scope} onValueChange={(value) => setScope(value as InstallScope)} className="mt-2 grid grid-cols-2 gap-3">{scopeOptions.map((option) => { const isInstalled = installed[option.value]; const disabled = option.value === "project" ? projectUnavailable : globalUnavailable; return <label key={option.value} title={disabled ? isInstalled ? t("extensions.scopeAlreadyInstalled") : t("extensions.projectUntrusted") : option.note} className={`relative flex min-w-0 items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] p-3 transition-colors ${disabled ? "cursor-not-allowed bg-[var(--bg-hover)] opacity-60" : scope === option.value ? "cursor-pointer bg-[var(--bg-hover)]" : "cursor-pointer hover:bg-[var(--bg-hover)]"}`}><RadioGroupItem value={option.value} disabled={disabled} className="sr-only" /><ScopeIcon scope={option.value} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-[var(--text)]">{option.title}</span>{isInstalled ? <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{t("extensions.alreadyInstalled")}</span> : null}</span><span className="mt-1 block truncate whitespace-nowrap text-xs text-[var(--text-muted)]">{option.note}</span></span>{scope === option.value && !disabled ? <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--text)] text-xs font-bold text-[var(--bg-panel)]">✓</span> : null}</label>; })}</RadioGroup>{scope === "project" && projectTrusted === false && !installed.project ? <p className="mt-2 text-xs text-red-600">{t("extensions.projectUntrusted")}</p> : null}</div>{item.type === "MCP" ? <RuntimeFields value={runtime} onChange={setRuntime} /> : null}{error ? <NotificationNotice type="error" message={error} /> : null}</div><footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3"><button type="button" disabled={busy || completed} onClick={onClose} className="h-8 rounded-[var(--radius-control)] border border-[var(--border)] px-3 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50">{t("extensions.cancel")}</button><button type="button" disabled={busy || completed || selectedUnavailable || noInstallableScope || projectTrusted === null} onClick={() => void submit()} className="inline-flex h-8 items-center rounded-[var(--radius-control)] bg-[var(--text)] px-3 text-sm font-medium text-[var(--bg-panel)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] disabled:hover:opacity-100">{busy ? <><RefreshCwIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t("extensions.installing")}</> : completed ? <><CheckIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.installedSuccess")}</> : t("extensions.confirmInstall")}</button></footer></DialogFrame>;
}

export function HazeMcpConfigDialog({ item, initial, busy, onClose, onConfirm }: { item: OrganizationExtensionDetailItem; initial: McpRuntimeOptions; busy: boolean; onClose: () => void; onConfirm: (runtime: McpRuntimeOptions) => Promise<boolean> }) {
  const { t } = useI18n();
  const { lifecycle: initialLifecycle, idleTimeout: initialIdleTimeout } = initial;
  const [runtime, setRuntime] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRuntime({ lifecycle: initialLifecycle, idleTimeout: initialIdleTimeout }); setError(null); }, [initialLifecycle, initialIdleTimeout]);
  const submit = async () => { if (!validOptions(runtime)) { setError(t("extensions.invalidIdleTimeout")); return; } setError(null); await onConfirm(runtime); };
  return <DialogFrame title={t("extensions.configureDialogTitle", { name: item.name })} onClose={busy ? () => undefined : onClose}><div className="space-y-5 p-5"><RuntimeFields value={runtime} onChange={setRuntime} />{error ? <NotificationNotice type="error" message={error} /> : null}</div><footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3"><button type="button" disabled={busy} onClick={onClose} className="h-8 rounded-[var(--radius-control)] border border-[var(--border)] px-3 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50">{t("extensions.cancel")}</button><button type="button" disabled={busy} onClick={() => void submit()} className="h-8 rounded-[var(--radius-control)] bg-blue-500 px-3 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50">{busy ? t("extensions.saving") : t("extensions.saveConfiguration")}</button></footer></DialogFrame>;
}

