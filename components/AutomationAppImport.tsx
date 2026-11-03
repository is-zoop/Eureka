"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AutomationAppIndex, AutomationAppManifest } from "@/lib/automation-app";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

interface Preview { manifest: AutomationAppManifest; digest: string; existingRevision: number; existingVersion: string | null }
export interface AutomationAppImportHandle { open: () => void }

export const AutomationAppImport = forwardRef<AutomationAppImportHandle, {
  index: AutomationAppIndex; active: boolean; onInstalled: (id: string) => void; onBusyChange: (busy: boolean) => void;
}>(function AutomationAppImport({ index, active, onInstalled, onBusyChange }, ref) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [file, setFile] = useState<File | null>(null);
  const upload = useRef<HTMLInputElement>(null), alive = useRef(false), operation = useRef(false), activeRef = useRef(active), viewGeneration = useRef(0);
  activeRef.current = active;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++viewGeneration.current; }; }, []);
  useEffect(() => { ++viewGeneration.current; if (!active) { setOpen(false); setPreview(null); setFile(null); setError(""); } }, [active]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useImperativeHandle(ref, () => ({ open: () => { if (activeRef.current && !operation.current) upload.current?.click(); } }), []);

  function query(extra: Record<string, string>) { return new URLSearchParams({ ownerKey: index.ownerKey, runtimeId: index.runtimeId, ...extra }); }
  async function work(task: (current: () => boolean) => Promise<void>) {
    if (operation.current || !activeRef.current) return;
    const token = viewGeneration.current, current = () => alive.current && activeRef.current && token === viewGeneration.current;
    operation.current = true; setBusy(true); setError("");
    try { await task(current); }
    catch (cause) { if (current()) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : t("automationSettings.requestFailed")); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function inspect(chosen: File) {
    setOpen(true); setPreview(null); setFile(null);
    await work(async current => {
      if (chosen.size > 20 * 1024 * 1024) throw new Error(t("automationSettings.fileTooLarge"));
      const response = await fetch(`/api/automation/apps/package?${query({ mode: "inspect" })}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: chosen, signal: AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t("automationSettings.requestFailed"));
      if (current()) { setPreview(data); setFile(chosen); }
    });
  }
  async function install() {
    if (!preview || !file) return;
    await work(async current => {
      const response = await fetch(`/api/automation/apps/package?${query({ mode: "install", digest: preview.digest, revision: String(preview.existingRevision) })}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file, signal: AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t("automationSettings.requestFailed"));
      if (!current()) return;
      setOpen(false); setPreview(null); setFile(null); onInstalled(data.id);
    });
  }

  return <>
    <input ref={upload} type="file" accept=".zip,application/zip" hidden disabled={busy || !active} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ""; if (chosen) void inspect(chosen); }} />
    <Dialog open={open && active} onOpenChange={value => { if (!operation.current) setOpen(value); }}><DialogContent>
      <DialogHeader><DialogTitle>{t("automationSettings.import")}</DialogTitle></DialogHeader>
      <DialogBody>
        {error && <p role="alert" className="m-0 text-sm text-[var(--danger,#b42318)]">{error}</p>}
        {busy && !preview && <p role="status" className="text-sm text-[var(--text-muted)]">{t("automationSettings.inspecting")}</p>}
        {preview && <div className="flex flex-col gap-3 text-[13px] leading-5">
          <h3 className="m-0 text-sm font-medium">{preview.manifest.displayName}</h3>
          <p className="m-0 text-[var(--text-muted)]">{preview.manifest.description}</p>
          <p className="m-0">{preview.manifest.version}{preview.existingVersion ? ` · ${t("automationSettings.updateFrom", { version: preview.existingVersion })}` : ""}</p>
          <p className="m-0 text-[var(--text-muted)]">{preview.manifest.automation.capabilities.map(capability => t(`automationSettings.capability.${capability}`)).join(locale === "zh-CN" ? "、" : ", ") || t("automationSettings.noCapabilities")}</p>
        </div>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("automationSettings.cancel")}</Button>
        {preview ? <Button disabled={busy || !active} onClick={() => void install()}>{t("automationSettings.install")}</Button> : !busy && <Button disabled={!active} onClick={() => upload.current?.click()}>{t("automationSettings.choosePackage")}</Button>}
      </DialogFooter>
    </DialogContent></Dialog>
  </>;
});
