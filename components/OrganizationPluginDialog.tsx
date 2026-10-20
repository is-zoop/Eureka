"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { NotificationNotice } from "./Notifications";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import type { InstallScope, McpRuntimeOptions } from "./HazeCapabilityDialog";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";

export type PluginConfirmation = { preparationToken: string; approveAddresses: boolean };
type Prepared = { preparationToken: string; expiresAt: number; version: string; name: string; skills: string[]; servers: Array<{ name: string; url: string; auth?: string }>; requiresApproval: boolean; capabilities?: { requestUserInput?: boolean } };
export type PluginDialogOptions = { operation?: "install" | "update"; fixedScope?: InstallScope };
export function OrganizationPluginDialog({ item, cwd, busy, onClose, onConfirm, operation = "install", fixedScope }: { item: OrganizationExtensionDetailItem; cwd: string; busy: boolean; onClose: () => void; onConfirm: (scope: InstallScope, runtime?: McpRuntimeOptions, plugin?: PluginConfirmation) => Promise<boolean> } & PluginDialogOptions) {
  const { t } = useI18n();
  const [scope, setScope] = useState<InstallScope>(fixedScope ?? "project");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [availability, setAvailability] = useState<{ trusted: boolean; global: boolean; project: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal }).then((response) => response.json()),
      fetch(`/api/organization-extensions/${item.id}/installation?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal }).then((response) => response.json()),
    ]).then(([trust, installed]) => {
      if (controller.signal.aborted) return;
      const next = { trusted: trust.trusted === true, global: installed.global?.some((entry: { type?: string }) => entry.type === "Plugin") === true, project: installed.project?.some((entry: { type?: string }) => entry.type === "Plugin") === true };
      setAvailability(next);
      if (!fixedScope && (!next.trusted || next.project) && !next.global) setScope("global");
    }).catch(() => { if (!controller.signal.aborted) { setError(t("extensions.pluginPrepareFailed")); setLoading(false); } });
    return () => controller.abort();
  }, [cwd, item.id, fixedScope, revision, t]);
  useEffect(() => {
    if (!availability) return;
    const controller = new AbortController();
    setPrepared(null); setApproved(false); setError(null); setLoading(true);
    if ((scope === "project" && !availability.trusted) || (operation === "install" && availability[scope])) { setLoading(false); setError(t("extensions.pluginScopeUnavailable")); return; }
    void fetch(`/api/organization-extensions/${item.id}/installation`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, type: "Plugin", action: "prepare", operation }) })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? t("extensions.pluginPrepareFailed")); if (!controller.signal.aborted) setPrepared(payload); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [availability, cwd, item.id, operation, scope, t]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section role="dialog" aria-modal="true" aria-label={t("extensions.installDialogTitle", { name: item.name })} className="w-full max-w-xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-soft)]">
    <header className="flex items-center gap-3 border-b border-[var(--border)] p-4 font-semibold"><OrganizationCapabilityIcon capability={{ capabilityId: item.id }} iconUrl={item.iconUrl} size={32} /><span>{operation === "update" ? t("extensions.update") : t("extensions.install")} · {item.name}</span></header>
    <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4 text-sm">
      <fieldset disabled={busy || Boolean(fixedScope)} className="flex gap-4"><legend className="mb-2 font-medium">{t("extensions.installScope")}</legend>{(["project", "global"] as const).map((value) => <label key={value} className="flex items-center gap-2"><input type="radio" name="plugin-scope" checked={scope === value} onChange={() => setScope(value)} />{t(`extensions.${value}`)}</label>)}</fieldset>
      {loading ? <p>{t("extensions.pluginPreparing")}</p> : null}
      <NotificationNotice type="error" message={error} />
      {prepared ? <><p>{prepared.name} · v{prepared.version}</p><div><p className="font-medium">{t("extensions.pluginComponents")}</p>{prepared.skills.map((skill) => <p key={skill} className="break-all text-[var(--text-muted)]">Skill · {skill}</p>)}</div>
        {prepared.capabilities?.requestUserInput && <p>{t("extensions.pluginUserInput")}</p>}
        {prepared.servers.map((server) => <div key={server.name} className="rounded-[var(--radius-control)] border border-[var(--border)] p-3"><p className="font-medium">MCP · {server.name}</p><p className="break-all text-[var(--text-muted)]">{server.url}</p><p className="mt-1 text-xs">{server.auth ? t("extensions.pluginCredentialNotice") : t("extensions.pluginAnonymous")}</p></div>)}
        {prepared.requiresApproval ? <label className="flex items-start gap-2"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-1" /><span>{t("extensions.pluginApproveAddresses")}</span></label> : null}
      </> : null}
    </div><footer className="flex justify-end gap-2 border-t border-[var(--border)] p-4"><Button variant="outline" disabled={busy} onClick={onClose}>{t("extensions.cancel")}</Button>{!loading && !prepared ? <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>{t("extensions.reload")}</Button> : null}<Button disabled={busy || loading || !prepared || (prepared.requiresApproval && !approved)} onClick={async () => {
      if (!prepared) return;
      if (prepared.expiresAt <= Date.now()) { setError(t("extensions.pluginPreparationExpired")); setPrepared(null); return; }
      const success = await onConfirm(scope, undefined, { preparationToken: prepared.preparationToken, approveAddresses: approved });
      if (!success) { setPrepared(null); setError(t("extensions.pluginPrepareAgain")); }
    }}>{busy ? t("extensions.installing") : t("extensions.confirmInstall")}</Button></footer>
  </section></div>;
}
