"use client";

import { useI18n } from "@/hooks/useI18n";
import { useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { getWrittenFileStats, summarizeWrittenFiles, type ChangeLineStats, type OpenTurnChanges, type WrittenFile } from "@/lib/turn-written-files";
import { LabelTooltip } from "./LabelTooltip";
import { getFileIcon } from "./FileIcons";

export function ChangeStats({ stats }: { stats: ChangeLineStats | null }) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  if (!stats) return <span aria-label={t("chat.fileStatsUnknown")} className="shrink-0 text-xs text-[var(--text-dim)]">—</span>;
  return <span className="flex shrink-0 gap-1 text-xs tabular-nums">
    <span style={{ color: isDark ? "#4ade80" : "#16803c" }}>+{stats.additions}</span>
    <span style={{ color: isDark ? "#f87171" : "#dc2626" }}>-{stats.deletions}</span>
  </span>;
}

export function WrittenFilePath({ filePath, cwd }: { filePath: string; cwd?: string }) {
  const name = getFileName(filePath);
  const displayPath = getRelativeFilePath(filePath, cwd);
  const directory = displayPath.slice(0, displayPath.length - name.length);
  return <span className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
    <span aria-hidden="true" className="flex shrink-0">{getFileIcon(name, 14)}</span>
    <span className="flex min-w-0 flex-1">
      {directory && <span className="truncate text-[var(--text-muted)]">{directory}</span>}
      <span className={directory ? "max-w-[70%] shrink-0 truncate text-[var(--text)]" : "truncate text-[var(--text)]"}>{name}</span>
    </span>
  </span>;
}

/** A compact summary of this turn's successful file edits, not Git status. */
export function TurnWrittenFiles({ files, cwd, sessionId, onOpenFile, onOpenChanges }: {
  files: WrittenFile[];
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
  onOpenChanges?: OpenTurnChanges;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const summary = summarizeWrittenFiles(files);
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const openChanges = (filePath = files[0].filePath) => {
    if (onOpenChanges) onOpenChanges({ files, cwd, sessionId, selectedFilePath: filePath });
    else onOpenFile?.(filePath);
  };
  return (
    <section aria-label={t("chat.filesWritten")} className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]">
      <header className="flex min-h-11 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--bg-subtle)] text-[var(--text-muted)]" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M12 7v8m-4-4h8M8 18h8" /></svg>
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{t(files.length === 1 ? "chat.fileEdited" : "chat.filesEdited", { count: files.length })}</div>
        {summary.knownFiles > 0 && <LabelTooltip content={t("chat.fileStatsDescription")}>
          <span className="inline-flex shrink-0 items-center">
            <ChangeStats stats={summary} />
          </span>
        </LabelTooltip>}
      </header>
      <div className="py-0.5">
        {visibleFiles.map((file) => <LabelTooltip key={file.filePath} content={file.filePath}>
          <button type="button" aria-label={t("chat.viewFileChanges", { path: file.filePath })} disabled={!onOpenChanges && !onOpenFile} onClick={() => openChanges(file.filePath)} className="flex h-9 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 hover:bg-[var(--bg-hover)] disabled:cursor-default">
            <WrittenFilePath filePath={file.filePath} cwd={cwd} />
            <ChangeStats stats={getWrittenFileStats(file)} />
          </button>
        </LabelTooltip>)}
      </div>
      {files.length > 3 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
        {expanded ? t("chat.collapseFiles") : t("chat.showMoreFiles", { count: files.length - 3 })}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? "m3 8 3-3 3 3" : "m3 4 3 3 3-3"} /></svg>
      </button>}
    </section>
  );
}
