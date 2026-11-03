"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircleIcon, ArrowRightIcon, CheckIcon, DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";
import { useI18n } from "@/hooks/useI18n";
import { DESKTOP_UPDATE_OPEN_EVENT, desktopUpdateController, updateBusy, updateErrorKey, type UpdateAction, type UpdateView } from "@/lib/desktop-update-controller";
import { APP_VERSION } from "@/lib/app-update";
import { LabelTooltip } from "./LabelTooltip";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "./ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import styles from "./DesktopUpdateButton.module.css";

function formatBytes(bytes: number, locale: string) {
  const unit = bytes >= 1024 ** 3 ? "GB" : bytes >= 1024 ** 2 ? "MB" : "KB";
  const divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`;
}

export function DesktopUpdateContent({ view, run, close }: { view: UpdateView; run: (action: UpdateAction) => void; close: () => void }) {
  const { t, locale } = useI18n();
  const { state, pending, error, loading } = view;
  const busy = updateBusy(view);
  const disabled = state?.enabled === false;
  const phase = pending === "check" ? "checking" : pending === "download" ? "downloading" : pending === "install" ? "installing" : state?.phase ?? "idle";
  const ready = Boolean(state?.readyToInstall);
  const hasUpdate = Boolean(state?.version);
  const downloading = phase === "downloading";
  const percent = state?.totalBytes ? Math.max(0, Math.min(100, Math.floor(state.downloadedBytes / state.totalBytes * 100))) : null;
  const heading = disabled ? "updates.disabledTitle" : loading ? "updates.loading" : error ? "updates.failed" : phase === "checking" ? "updates.checking" : phase === "installing" ? "updates.installing" : downloading ? "updates.downloading" : ready ? "updates.ready" : hasUpdate ? "updates.available" : phase === "upToDate" ? "updates.upToDate" : "updates.welcome";
  const description = disabled ? "updates.disabled" : phase === "installing" ? "updates.installingDescription" : downloading ? "updates.downloadDescription" : ready ? "updates.installDescription" : hasUpdate ? "updates.availableDescription" : phase === "upToDate" ? "updates.upToDateDescription" : "updates.checkDescription";
  const action: UpdateAction = ready ? "install" : hasUpdate ? "download" : "check";
  const actionLabel = busy ? phase === "installing" ? "updates.installing" : downloading ? "updates.downloading" : "updates.checking" : ready ? "updates.install" : hasUpdate ? error ? "updates.retryDownload" : "updates.download" : error ? "updates.retry" : "updates.check";
  return <>
    <DialogHeader><DialogTitle>{t("updates.title")}</DialogTitle><DialogDescription>{t("updates.current", { version: state?.currentVersion ?? APP_VERSION })}</DialogDescription></DialogHeader>
    <DialogBody>
      <div className={styles.status}>
        <div className={styles.statusIcon} aria-hidden="true">{busy ? <LoaderCircleIcon size={20} className={styles.spin} /> : error ? <AlertCircleIcon size={20} /> : ready || phase === "upToDate" ? <CheckIcon size={20} /> : <DownloadIcon size={20} />}</div>
        <div className="min-w-0 flex-1"><h3 className={styles.headline} role="status" aria-live="polite">{t(heading, { version: state?.version ?? "" })}</h3><p className={styles.description}>{t(description)}</p>
          {hasUpdate && <div className={styles.versions}><span className={styles.version}>{state?.currentVersion}</span><ArrowRightIcon size={13} aria-hidden="true" /><span className={`${styles.version} ${styles.newVersion}`}>{state?.version}</span></div>}
        </div>
      </div>
      {downloading && <div>
        <div className={styles.progress} role="progressbar" aria-label={t("updates.downloadProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><div className={`${styles.fill}${percent === null ? ` ${styles.indeterminate}` : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} /></div>
        <div className={styles.size}><span>{formatBytes(state?.downloadedBytes ?? 0, locale)}{state?.totalBytes ? ` / ${formatBytes(state.totalBytes, locale)}` : ""}</span><span>{percent === null ? t("updates.connecting") : `${percent}%`}</span></div>
      </div>}
      {error && <div role="alert" className={styles.error}>{t(updateErrorKey(error))}</div>}
      {state?.notes?.trim() && <section className={styles.notes}><h4 className={styles.notesTitle}>{t("updates.notes")}</h4><MarkdownBody className="text-[13px] leading-relaxed" isStreaming={false}>{state.notes}</MarkdownBody></section>}
    </DialogBody>
    <DialogFooter className="flex-wrap">
      {hasUpdate && !ready && <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => run("check")}><RefreshCwIcon size={13} className="mr-1.5" />{t("updates.check")}</Button>}
      <Button size="sm" variant="outline" onClick={close}>{t(busy || hasUpdate ? "updates.later" : "common.close")}</Button>
      {!disabled && <Button size="sm" disabled={busy} onClick={() => run(action)}>{busy && <LoaderCircleIcon size={13} className={`mr-1.5 ${styles.spin}`} />}{t(actionLabel)}</Button>}
    </DialogFooter>
  </>;
}

export function DesktopUpdateButton() {
  const view = useDesktopUpdater();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const openFromHelp = () => { setOpen(true); desktopUpdateController.requestCheck(); };
    window.addEventListener(DESKTOP_UPDATE_OPEN_EVENT, openFromHelp);
    return () => window.removeEventListener(DESKTOP_UPDATE_OPEN_EVENT, openFromHelp);
  }, []);
  if (!view.host) return null;
  const busy = updateBusy(view);
  const ready = Boolean(view.state?.readyToInstall);
  const available = Boolean(view.state?.version);
  const tooltip = ready ? t("updates.ready") : available ? t("updates.available", { version: view.state!.version! }) : busy ? t("updates.inProgress") : t("updates.open");
  return <Dialog open={open} onOpenChange={setOpen}>
    <LabelTooltip content={tooltip} side="right"><button ref={trigger} type="button" className={styles.trigger} aria-label={t("updates.open")} aria-haspopup="dialog" data-desktop-update-trigger onClick={() => setOpen(true)}>
      <span className={styles.badge} aria-hidden="true">{busy ? <LoaderCircleIcon size={14} className={styles.spin} /> : ready ? <CheckIcon size={14} strokeWidth={2} /> : <DownloadIcon size={14} strokeWidth={2} />}</span>
      {available && !busy && <span className={styles.dot} aria-hidden="true" />}
    </button></LabelTooltip>
    <DialogContent className="w-[min(440px,calc(100vw-32px))]" finalFocus={trigger}>
      <DesktopUpdateContent view={view} run={view.run} close={() => setOpen(false)} />
    </DialogContent>
  </Dialog>;
}
