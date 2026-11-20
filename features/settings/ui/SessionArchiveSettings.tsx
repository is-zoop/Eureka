"use client";

import { useCallback, useEffect, useState } from "react";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/features/files/shared/file-paths";
import { notify } from "@/features/workspace/shared/notification-store";
import { changeSessionArchive } from "@/features/sessions/client/session-archive-client";
import { getSessionDisplayTitle } from "@/features/sessions/shared/session-display-title";
import type { SessionArchive, SessionInfo } from "@/lib/types";
import { DeleteSessionDialog } from "../../sessions/ui/DeleteSessionDialog";
import { LabelTooltip } from "../../workspace/ui/LabelTooltip";
import { SettingsLayout, SettingsSection, SettingsCard, SettingsRow } from "../../../components/SettingsLayout";
import { SettingsSelect } from "./SettingsSelect";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";

type ArchivedSession = SessionInfo & { archive: SessionArchive };

export interface SessionArchiveSettingsActions {
  onRestoreArchive?: (id: string) => Promise<boolean>;
  onSessionDeleted?: (id: string) => void;
}

const ALL_PROJECTS = "all";
const projectOf = (session: SessionInfo) => session.projectRoot || session.cwd;

export function SessionArchiveSettings({ onRestoreArchive, onSessionDeleted }: SessionArchiveSettingsActions) {
  const { locale, t } = useI18n();
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [project, setProject] = useState(ALL_PROJECTS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = restoring !== null || deleting;

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch("/api/sessions/archived", { cache: "no-store", signal });
      if (!response.ok) throw new Error("archive_load_failed");
      const { sessions } = await response.json() as { sessions: ArchivedSession[] };
      if (!signal?.aborted) setSessions(sessions);
    } catch {
      if (!signal?.aborted) setLoadFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadSessions]);

  async function restore(id: string) {
    setRestoring(id);
    try {
      if (onRestoreArchive) {
        if (!await onRestoreArchive(id)) return;
      } else {
        await changeSessionArchive(id, false);
        notify({ type: "success", message: t("archive.restored") });
      }
      setSessions((list) => list.filter((session) => session.id !== id));
    } catch {
      notify({ type: "error", message: t("archive.failed") });
    } finally {
      setRestoring(null);
    }
  }

  async function deleteArchivedSession() {
    if (!deleteTarget || busy) return;
    const { id } = deleteTarget;
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSessions((list) => list.filter((session) => session.id !== id));
      setDeleteTarget(null);
      onSessionDeleted?.(id);
      notify({ type: "success", message: t("archive.deleted") });
    } catch {
      notify({ type: "error", message: t("archive.deleteFailed") });
    } finally {
      setDeleting(false);
    }
  }

  const projects = new Set(sessions.map(projectOf));
  if (project !== ALL_PROJECTS) projects.add(project);
  const projectOptions = [...projects]
    .map((path) => ({ value: path, label: getFileName(path) || path }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const visibleSessions = sessions.filter((session) => project === ALL_PROJECTS || projectOf(session) === project)
    .sort((a, b) => (b.archive.lastConversationAt ?? "").localeCompare(a.archive.lastConversationAt ?? "")
      || b.archive.archivedAt.localeCompare(a.archive.archivedAt));
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <SettingsLayout title={t("archive.settings")} description={t("archive.settingsDescription")}>
      <SettingsSection title={t("archive.list")} meta={loading || loadFailed ? undefined : visibleSessions.length}>
        <SettingsCard className="divide-y divide-[var(--border)] px-4">
          <SettingsRow label={t("archive.projectFilter")} description={t("archive.projectFilterDescription")}>
            <SettingsSelect label={t("archive.projectFilter")} value={project} onValueChange={setProject} closeOnSelect
              options={[{ value: ALL_PROJECTS, label: t("archive.allProjects") }, ...projectOptions]}
              disabled={loading || loadFailed || projects.size === 0} />
          </SettingsRow>
          {loading ? (
            <div role="status" aria-label={t("sidebar.loading")} className="py-4"><Skeleton className="h-4 w-36" /></div>
          ) : loadFailed ? (
            <SettingsRow label={t("archive.loadFailed")} description={t("archive.loadRetryDescription")}>
              <Button variant="outline" size="sm" onClick={() => void loadSessions()}>{t("chat.retryHistory")}</Button>
            </SettingsRow>
          ) : visibleSessions.length === 0 ? (
            <p className="my-0 py-4 text-xs text-[var(--text-muted)]">{t("archive.empty")}</p>
          ) : visibleSessions.map((session) => {
            const { archive } = session;
            const path = projectOf(session);
            const title = getSessionDisplayTitle(session, session.id);
            const date = archive.lastConversationAt ? dateFormat.format(new Date(archive.lastConversationAt)) : t("archive.noDate");
            return (
              <SettingsRow key={session.id} label={
                <LabelTooltip content={title}>
                  <span className="block truncate" tabIndex={0}>{title}</span>
                </LabelTooltip>
              }
                description={t("archive.rowDetails", { project: getFileName(path) || path, count: archive.turnCount, date })}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" className="gap-1.5 bg-black text-white dark:bg-white dark:text-black" disabled={busy} onClick={() => void restore(session.id)}>
                    <ArchiveRestoreIcon size={14} aria-hidden="true" />{t(restoring === session.id ? "archive.restoring" : "archive.restore")}
                  </Button>
                  <Button type="button" size="sm" variant="destructive" className="gap-1.5 text-red-700 dark:text-red-300" disabled={busy} onClick={() => setDeleteTarget(session)}>
                    <Trash2Icon size={14} aria-hidden="true" />{t("sidebar.delete")}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </SettingsSection>
      {deleteTarget && <DeleteSessionDialog open title={getSessionDisplayTitle(deleteTarget, deleteTarget.id)} deleting={deleting}
        onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteArchivedSession()} />}
    </SettingsLayout>
  );
}
