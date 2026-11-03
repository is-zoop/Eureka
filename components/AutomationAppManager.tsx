"use client";
import { useI18n } from "@/hooks/useI18n";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AutomationAppDetail, AutomationAppIndex, AutomationAppInstall } from "@/lib/automation-app";
import { saveFileAs } from "@/lib/save-file";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { RemovalDialog } from "./RemovalDialog";
import { notify } from "@/lib/notification-store";
import { Alert, AlertDescription } from "./ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "./ui/dialog";
import type { AutomationAppDetailsRequest } from "./AutomationAppDetails";
import { AutomationApplication, type AutomationApplicationHandle } from "./AutomationApplication";
import styles from "./AutomationApps.module.css";

const errorText = (e: unknown, t: (key: string) => string) => e instanceof Error ? e.name === "TimeoutError" ? t("automationUi.localTimeout") : e.message : t("automationUi.retryOperation");
export type AutomationAppMenuAction = "history" | "refresh" | "info" | "save-as" | "modify" | "export" | "uninstall" | "clear-data";
export interface AutomationAppMenuState { id: string; blocked: boolean }
export interface AutomationAppManagerHandle { perform: (action: AutomationAppMenuAction, appId: string) => void }
export const AutomationAppManager = forwardRef<AutomationAppManagerHandle, {
  index: AutomationAppIndex; selected: string; active: boolean; cwd?: string;
  onSelect: (id: string | null, reveal?: boolean) => void; onChanged: () => void;
  onRunningChange?: (running: boolean) => void;
  onMenuStateChange: (state: AutomationAppMenuState | null) => void;
  onOpenDetails: (request: AutomationAppDetailsRequest) => void;
}>(function AutomationAppManager({ index, selected, active, cwd, onSelect, onChanged, onRunningChange, onMenuStateChange, onOpenDetails }, ref) {
  const { t } = useI18n();
  const translation = useRef(t); translation.current = t;
  const [detail, setDetail] = useState<AutomationAppDetail | null>(null);
  const [appRunning, setAppRunning] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ action: "uninstall" | "clear-data"; id: string; revision: number; name: string } | null>(null);
  const [copyDraft, setCopyDraft] = useState<{id:string;revision:number;newId:string;name:string} | null>(null);
  const alive = useRef(true), operation = useRef(false), selectedRef = useRef(selected), activeRef = useRef(active);
  const runtime = useRef<AutomationApplicationHandle>(null);
  selectedRef.current = selected; activeRef.current = active;
  const sameView = () => alive.current && selectedRef.current === selected && activeRef.current;
  const current = index.apps.find(app => app.id === selected);
  useEffect(() => { onRunningChange?.(appRunning); return () => onRunningChange?.(false); }, [appRunning, onRunningChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setAppRunning(false); setDetail(null); setError(""); setConfirmation(null); setCopyDraft(null); }, [selected]);
  useEffect(() => {
    if (!selected || !current || !active) { setDetail(null); return; }
    const abort = new AbortController(); setLoading(true); setDetail(null); setError("");
    void fetch(`/api/automation/apps/${encodeURIComponent(selected)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.ownerKey !== index.ownerKey || data.runtimeId !== index.runtimeId) throw new Error(translation.current("automationUi.identityChanged"));
      if (!abort.signal.aborted) setDetail(data);
    }).catch(e => { if (!abort.signal.aborted) setError(errorText(e, translation.current)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [selected, current?.revision, active, index.ownerKey, index.runtimeId]);
  async function work(task: () => Promise<void>) {
    if (operation.current || !active) return false;
    operation.current = true; setBusy(true); setError("");
    try { await task(); return true; } catch (e) { if (sameView()) setError(errorText(e, translation.current)); return false; }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function identityQuery(extra: Record<string, string>) { return new URLSearchParams({ ownerKey: index.ownerKey, runtimeId: index.runtimeId, ...extra }); }
  async function change(action: string, app: Pick<AutomationAppInstall, "id" | "revision">, extra: Record<string, unknown> = {}) {
    return work(async () => {
      const response = await fetch("/api/automation/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: app.id, revision: app.revision, ownerKey: index.ownerKey, runtimeId: index.runtimeId, ...extra }), signal: AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!alive.current) return;
      onChanged(); if (!sameView()) return;
      if (data.warning) notify({ type: "warning", message: data.warning });
      if (action === "uninstall") onSelect(null);
    });
  }
  async function download(extra: Record<string, string>, filename: string) {
    await work(async () => {
      await saveFileAs(filename, async () => {
        const response = await fetch(`/api/automation/apps/package?${identityQuery(extra)}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
        if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
        return response.blob();
      }, sameView);
    });
  }
  async function saveAs() {
    if (!copyDraft || !copyDraft.name.trim() || copyDraft.name.trim().length > 100) return;
    const draft = copyDraft;
    await work(async () => {
      const response = await fetch("/api/automation/apps", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"save-as",id:draft.id,revision:draft.revision,newId:draft.newId,displayName:draft.name.trim(),ownerKey:index.ownerKey,runtimeId:index.runtimeId}),signal:AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.id !== draft.newId || data.managedPlugin) throw new Error(t("automationUi.saveAsUnconfirmed"));
      if (!alive.current) return;
      onChanged(); if (!sameView()) return;
      setCopyDraft(null); onSelect(data.id,true);
    });
  }
  const disabled = busy || !active;
  const menuBlocked = disabled || loading || appRunning || !detail || detail.install.id !== selected;
  useEffect(() => { onMenuStateChange({ id: selected, blocked: menuBlocked }); }, [selected, menuBlocked, onMenuStateChange]);
  useEffect(() => () => onMenuStateChange(null), [onMenuStateChange]);
  useImperativeHandle(ref, () => ({ perform: (action, appId) => {
    if (appId !== selectedRef.current || !sameView() || operation.current || menuBlocked || !detail || !runtime.current?.canManage()) return;
    if (action === "history") runtime.current.openHistory();
    else if (action === "refresh") runtime.current.refresh();
    else if (action === "info") onOpenDetails({ detail, index, cwd, onChanged });
    else if (action === "save-as") { if(!detail.install.managedPlugin)return; setError(""); setCopyDraft({id:detail.install.id,revision:detail.install.revision,newId:crypto.randomUUID(),name:t("automationUi.copyName", { name: detail.manifest.displayName.slice(0,94) })}); }
    else if(detail.install.managedPlugin&&["modify","export"].includes(action))setError(t("automationUi.copyBeforeEdit"));
    else if(detail.install.managedPlugin&&action==="uninstall")setError(t("automationUi.managedUninstall"));
    else if (action === "modify") window.dispatchEvent(new CustomEvent("eureka:create-automation", { detail: { baseApp: { id: detail.install.id, revision: detail.install.revision, version: detail.manifest.version }, displayName: detail.manifest.displayName, ownerKey: index.ownerKey, runtimeId: index.runtimeId } }));
    else if (action === "export") void download({ id: detail.install.id }, `${detail.manifest.name}-${detail.manifest.version}.zip`);
    else if (action === "uninstall") setConfirmation({ action: "uninstall", id: detail.install.id, revision: detail.install.revision, name: detail.manifest.displayName });
    else if (action === "clear-data") setConfirmation({ action: "clear-data", id: detail.install.id, revision: detail.install.revision, name: detail.manifest.displayName });
  } }));
  return <section className={styles.runtimePage} aria-label={t("automationUi.app")}>
    {error && !copyDraft && !confirmation && <p className={styles.error} role="alert">{error}</p>}
    {current && (detail ? <AutomationApplication ref={runtime} key={`${current.id}:${detail.manifest.version}:${index.runtimeId}`} detail={detail} index={index} active={active} onRunningChange={setAppRunning} /> : loading ? <p className={styles.hint} role="status">{t("automationUi.loadingApp")}</p> : null)}
    <Dialog open={Boolean(copyDraft)} onOpenChange={open => {if(!open&&!operation.current){setCopyDraft(null);setError("");}}}><DialogContent><DialogHeader><DialogTitle>{t("automationUi.saveAs")}</DialogTitle></DialogHeader><DialogBody>
      <form id="automation-save-as" className="space-y-3" onSubmit={event => {event.preventDefault();void saveAs();}}>
        <label htmlFor="automation-copy-name" className="block text-sm font-medium">{t("automationUi.appName")}</label>
        <Input id="automation-copy-name" autoFocus required maxLength={100} disabled={disabled} className="focus-visible:border-[var(--border)]" value={copyDraft?.name??""} onChange={event => {setError("");setCopyDraft(previous => previous?{...previous,name:event.target.value}:null);}} />
        {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </form>
    </DialogBody><DialogFooter><Button variant="outline" disabled={disabled} onClick={() => {setCopyDraft(null);setError("");}}>{t("automationUi.cancel")}</Button><Button type="submit" form="automation-save-as" disabled={disabled||!copyDraft?.name.trim()}>{busy?t("automationUi.savingAs"):t("automationUi.confirm")}</Button></DialogFooter></DialogContent></Dialog>
    <RemovalDialog open={Boolean(confirmation)} name={confirmation?.name ?? ""} mode={confirmation?.action} allowDeleteData busy={disabled || appRunning} error={error} onClose={() => { setConfirmation(null); setError(""); }} onConfirm={async deleteData => {
      if (!confirmation) return false;
      return change(confirmation.action, confirmation, confirmation.action === "clear-data" ? { confirmAppId: confirmation.id } : { deleteData, confirmAppId: confirmation.id });
    }} />
  </section>;
});
