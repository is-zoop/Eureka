"use client";
import { useI18n } from "@/hooks/useI18n";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export function RemovalDialog({ open, name, mode = "uninstall", allowDeleteData = false, busy = false, error, onClose, onConfirm }: {
  open: boolean; name: string; mode?: "uninstall" | "clear-data"; allowDeleteData?: boolean; busy?: boolean; error?: string;
  onClose: () => void; onConfirm: (deleteData: boolean) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [deleteData, setDeleteData] = useState(false), [pending, setPending] = useState(false), [failure, setFailure] = useState("");
  useEffect(() => { if (open) { setDeleteData(false); setFailure(""); } }, [open, name, mode]);
  const locked = busy || pending;
  async function confirm() {
    if (locked) return;
    setPending(true); setFailure("");
    try { if (await onConfirm(mode === "clear-data" || deleteData)) onClose(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : t("automationUi.retry")); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !locked) onClose(); }}>
    <DialogContent className="max-w-md" aria-busy={locked}>
      <DialogHeader><DialogTitle>{mode === "clear-data" ? t("automationUi.deleteUserData") : t("automationUi.confirmUninstall")}</DialogTitle></DialogHeader>
      <DialogBody>
        <p className="m-0 text-sm leading-6">{mode === "clear-data" ? t("automationUi.deletePrompt", { name }) : t("automationUi.uninstallPrompt", { name })}</p>
        {mode === "uninstall" && allowDeleteData && <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm leading-6">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--text)]" checked={deleteData} disabled={locked} onChange={event => setDeleteData(event.target.checked)} />
          <span>{t("automationUi.alsoDeleteData")}<span className="block text-xs text-[var(--text-muted)]">{t("automationUi.deleteDataExplanation")}</span></span>
        </label>}
        {mode === "uninstall" && !deleteData && <p className="mb-0 mt-3 text-xs text-[var(--text-muted)]">{t("automationUi.dataRetained")}</p>}
        {(error || failure) && <p role="alert" className="mb-0 mt-4 text-sm text-[var(--danger)]">{error || failure}</p>}
      </DialogBody>
      <DialogFooter><Button variant="outline" size="sm" disabled={locked} onClick={onClose}>{t("automationUi.cancel")}</Button><Button variant="destructive" size="sm" disabled={locked} onClick={() => void confirm()}>{locked ? t("automationUi.processing") : mode === "clear-data" ? t("automationUi.deleteData") : t("automationUi.uninstall")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
