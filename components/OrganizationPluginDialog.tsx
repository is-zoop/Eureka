"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "./ui/dialog";
import { ExtensionErrorText } from "./ExtensionNotice";
import { Alert, AlertDescription } from "./ui/alert";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import type { InstallScope, McpRuntimeOptions } from "./HazeCapabilityDialog";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";

export type PluginConfirmation = { preparationToken: string; approveAddresses: boolean };
type Prepared = { preparationToken: string; expiresAt: number; version: string; name: string; skills: string[]; servers: Array<{ name: string; url: string; auth?: string }>; requiresApproval: boolean; capabilities?: { requestUserInput?: boolean }; composer?: { selectionMode: "once" | "persistent" } };
export type PluginDialogOptions = { operation?: "install" | "update"; fixedScope?: InstallScope };
export function OrganizationPluginDialog({ item, cwd, busy, onClose, onConfirm, operation = "install", fixedScope }: { item: OrganizationExtensionDetailItem; cwd: string; busy: boolean; onClose: () => void; onConfirm: (scope: InstallScope, runtime?: McpRuntimeOptions, plugin?: PluginConfirmation) => Promise<boolean> } & PluginDialogOptions) {
  const { t } = useI18n();
  const [scope, setScope] = useState<InstallScope>(fixedScope ?? "project");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approved, setApproved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const mounted = useRef(false), inFlight = useRef(false), attemptedToken = useRef<string | null>(null);
  const [availability, setAvailability] = useState<{ trusted: boolean; global: boolean; project: boolean } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAvailability(null); setPrepared(null); setApproved(false); setError(null); setRetryRequired(false); setLoading(true);
    const read = async (response: Response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? t("extensions.pluginPrepareFailed")); return payload; };
    void Promise.all([
      fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal }).then(read),
      fetch(`/api/organization-extensions/${item.id}/installation?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal }).then(read),
    ]).then(([trust, installed]) => {
      if (controller.signal.aborted) return;
      const next = { trusted: trust.trusted === true, global: installed.global?.some((entry: { type?: string }) => entry.type === "Plugin") === true, project: installed.project?.some((entry: { type?: string }) => entry.type === "Plugin") === true };
      setAvailability(next);
      if (fixedScope) setScope(fixedScope);
      else if ((!next.trusted || next.project) && !next.global) setScope("global");
    }).catch((cause) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : t("extensions.pluginPrepareFailed")); setLoading(false); } });
    return () => controller.abort();
  }, [cwd, item.id, fixedScope, revision, t]);
  useEffect(() => {
    if (!availability) return;
    const controller = new AbortController();
    setPrepared(null); setApproved(false); setError(null); setRetryRequired(false); setLoading(true);
    if ((scope === "project" && !availability.trusted) || (operation === "install" && availability[scope])) { setLoading(false); setError(t("extensions.pluginScopeUnavailable")); return; }
    void fetch(`/api/organization-extensions/${item.id}/installation`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, type: "Plugin", action: "prepare", operation }) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? t("extensions.pluginPrepareFailed"));
        if (typeof payload.preparationToken !== "string" || !/^[a-f0-9]{64}$/.test(payload.preparationToken) || !Number.isFinite(payload.expiresAt) || typeof payload.requiresApproval !== "boolean" || !Array.isArray(payload.servers)) throw new Error(t("extensions.pluginPrepareFailed"));
        if (!controller.signal.aborted) setPrepared(payload);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [availability, cwd, item.id, operation, scope, t]);
  const locked = busy || submitting;
  const needsConfirmation = !fixedScope || prepared?.requiresApproval === true;
  const confirm = useCallback(async (candidate: Prepared) => {
    if (inFlight.current || busy) return;
    if (candidate.expiresAt <= Date.now()) { setError(t("extensions.pluginPreparationExpired")); setPrepared(null); return; }
    if (candidate.requiresApproval && !approved) return;
    inFlight.current = true; setSubmitting(true);
    try {
      const success = await onConfirm(scope, undefined, { preparationToken: candidate.preparationToken, approveAddresses: candidate.requiresApproval && approved });
      // The parent reports the actual install error; do not add a second error toast.
      if (!success && mounted.current) { setPrepared(null); setRetryRequired(true); }
    } catch (cause) {
      if (mounted.current) { setPrepared(null); setError(cause instanceof Error ? cause.message : t("extensions.pluginPrepareFailed")); }
    } finally { inFlight.current = false; if (mounted.current) setSubmitting(false); }
  }, [approved, busy, onConfirm, scope, t]);
  useEffect(() => {
    if (!prepared || loading || locked || needsConfirmation || attemptedToken.current === prepared.preparationToken) return;
    // One submission per prepared package, including effect replays/rerenders.
    attemptedToken.current = prepared.preparationToken;
    void confirm(prepared);
  }, [confirm, loading, locked, needsConfirmation, prepared]);
  return <Dialog open onOpenChange={value => { if (!value && !locked && !inFlight.current) onClose(); }}><DialogContent className="max-w-xl" aria-busy={loading || locked}>
    <DialogHeader><DialogTitle className="flex items-center gap-3"><OrganizationCapabilityIcon capability={{ capabilityId: item.id }} iconUrl={item.iconUrl} size={32} /><span>{operation === "update" ? t("extensions.update") : t("extensions.install")} · {item.name}</span></DialogTitle></DialogHeader>
    <DialogBody className="space-y-4 text-sm">
      {!fixedScope && <fieldset disabled={locked} className="flex gap-4"><legend className="mb-2 font-medium">{t("extensions.installScope")}</legend>{(["project", "global"] as const).map((value) => <label key={value} className="flex items-center gap-2"><input type="radio" name="plugin-scope" checked={scope === value} onChange={() => setScope(value)} />{t(`extensions.${value}`)}</label>)}</fieldset>}
      {loading || locked || (prepared && !needsConfirmation) ? <p role="status" className="flex items-center gap-2 text-[var(--text-muted)]"><span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />{t(loading ? "extensions.pluginPreparing" : "extensions.installing")}</p> : null}
      {error ? <Alert variant="destructive"><AlertDescription><ExtensionErrorText error={error} /></AlertDescription></Alert> : null}
      {retryRequired ? <p className="text-[var(--text-muted)]">{t("extensions.pluginPrepareAgain")}</p> : null}
      {prepared && needsConfirmation ? <>
        {prepared.servers.map((server) => <div key={server.name} className="rounded-[var(--radius-control)] border border-[var(--border)] p-3"><p className="font-medium">{t("extensions.mcp")} · {server.name}</p><p className="break-all text-[var(--text-muted)]">{server.url}</p><p className="mt-1 text-xs">{server.auth ? t("extensions.pluginCredentialNotice") : t("extensions.pluginAnonymous")}</p></div>)}
        {prepared.requiresApproval ? <label className="flex items-center gap-2"><input type="checkbox" disabled={locked} checked={approved} onChange={(event) => setApproved(event.target.checked)} className="shrink-0" /><span>{t("extensions.pluginApproveAddresses")}</span></label> : null}
      </> : null}
    </DialogBody><DialogFooter><Button variant="outline" disabled={locked} onClick={() => { if (!inFlight.current) onClose(); }}>{t("extensions.cancel")}</Button>{!loading && !prepared ? <Button disabled={locked} variant="outline" onClick={() => setRevision((value) => value + 1)}>{t("extensions.reload")}</Button> : null}{needsConfirmation ? <Button disabled={locked || loading || !prepared || (prepared.requiresApproval && !approved)} onClick={() => { if (prepared) void confirm(prepared); }}>{locked ? t("extensions.installing") : t("extensions.confirmInstall")}</Button> : null}</DialogFooter>
  </DialogContent></Dialog>;
}
