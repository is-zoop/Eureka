"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getWrittenFileStats, type TurnChangesRequest } from "@/lib/turn-written-files";
import { LabelTooltip } from "./LabelTooltip";
import { PatchDiffView } from "./PatchDiffView";
import { ChangeStats, WrittenFilePath } from "./TurnWrittenFiles";

export function TurnChangesPanel({ request, onClose, onOpenFile }: {
  request: TurnChangesRequest;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const selected = request.selectedFilePath ?? request.files[0]?.filePath;
  const [expandedPaths, setExpandedPaths] = useState(() => new Set(selected ? [selected] : []));
  const selectedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return <section aria-label={t("chat.turnChanges")} className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-sm font-semibold text-[var(--text)]">{t("chat.turnChanges")}</h2>
        <p className="m-0 mt-1 text-xs text-[var(--text-muted)]">{t(request.files.length === 1 ? "chat.fileEdited" : "chat.filesEdited", { count: request.files.length })}</p>
      </div>
      <LabelTooltip content={t("chat.close")}>
        <button type="button" aria-label={t("chat.close")} onClick={onClose} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 8 8M11 3 3 11" /></svg>
        </button>
      </LabelTooltip>
    </header>
    <div className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">
      <p className="m-0 border-b border-[var(--border)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">{t("chat.fileStatsDescription")}</p>
      {request.files.map((file) => {
        const expanded = expandedPaths.has(file.filePath);
        return <section key={file.filePath} ref={file.filePath === selected ? selectedRef : undefined} className="border-b border-[var(--border)]">
          <LabelTooltip content={file.filePath}>
            <button type="button" aria-expanded={expanded} aria-label={t("chat.viewFileChanges", { path: file.filePath })} onClick={() => setExpandedPaths((previous) => {
              const next = new Set(previous);
              if (next.has(file.filePath)) next.delete(file.filePath); else next.add(file.filePath);
              return next;
            })} className="flex min-h-10 w-full cursor-pointer items-center gap-2 border-0 bg-[var(--bg-panel)] px-3 py-2 hover:bg-[var(--bg-hover)]">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-[var(--text-muted)]" aria-hidden="true"><path d={expanded ? "m2 3 3 3 3-3" : "m3 2 3 3-3 3"} /></svg>
              <WrittenFilePath filePath={file.filePath} cwd={request.cwd} />
              <ChangeStats stats={getWrittenFileStats(file)} />
            </button>
          </LabelTooltip>
          {expanded && <div>
            <div className="flex justify-end border-t border-[var(--border)] px-3 py-1.5">
              <button type="button" onClick={() => onOpenFile(file.filePath)} className="cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">{t("chat.openCurrentFile")}</button>
            </div>
            {file.changes?.length ? file.changes.map((change, index) => <div key={change.toolCallId}>
              {file.changes!.length > 1 && <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--text-muted)]">{t("chat.changeOperation", { index: index + 1 })}</div>}
              {change.patch ? <PatchDiffView text={change.patch} /> : <p className="m-0 px-3 py-4 text-xs text-[var(--text-muted)]">{t("chat.noTurnDiff")}</p>}
            </div>) : <p className="m-0 px-3 py-4 text-xs text-[var(--text-muted)]">{t("chat.noTurnDiff")}</p>}
          </div>}
        </section>;
      })}
    </div>
  </section>;
}
