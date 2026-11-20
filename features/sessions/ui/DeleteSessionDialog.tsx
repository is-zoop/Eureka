"use client";

import { Trash2Icon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DeleteSessionDialog({ open, title, deleting, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !deleting) onCancel(); }}>
      <AlertDialogContent>
        <div className="flex flex-col items-center px-6 pb-5 pt-6 text-center">
          <div className="mb-4 grid size-10 place-items-center rounded-lg bg-[var(--danger-hover)] text-[var(--danger)]">
            <Trash2Icon size={20} strokeWidth={2} aria-hidden="true" />
          </div>
          <AlertDialogTitle className="break-all">
            {t("sidebar.deleteSession", { title: title.slice(0, 28) + (title.length > 28 ? "…" : "") })}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 max-w-64">{t("sidebar.deleteSessionDescription")}</AlertDialogDescription>
        </div>
        <div className="flex gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3">
          <AlertDialogCancel disabled={deleting}>{t("sidebar.cancel")}</AlertDialogCancel>
          <Button type="button" size="sm" variant="destructive" disabled={deleting} onClick={onConfirm} className="flex-1">
            {deleting ? t("sidebar.deleting") : t("sidebar.delete")}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
