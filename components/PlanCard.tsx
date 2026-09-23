"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";

type Props = {
  id: string;
  markdown: string;
  revision?: number;
  defaultCollapsed: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  primaryAction?: { label: string; onClick: () => Promise<void> | void };
};

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || fallback;
}

function downloadMarkdown(markdown: string, revision?: number) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = revision ? `eureka-plan-${revision}.md` : "eureka-plan.md";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button
        type="button"
        aria-label={label}
        onClick={(event) => { event.stopPropagation(); onClick(); }}
        className="grid size-7 place-items-center rounded-md border-0 bg-transparent text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        {children}
      </button>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PlanCard({ id, markdown, revision, defaultCollapsed, cwd, onOpenFile, primaryAction }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [copied, setCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const title = titleFromMarkdown(markdown, t("plan.cardTitle"));

  useEffect(() => setCollapsed(defaultCollapsed), [id, defaultCollapsed]);

  const handleCopy = () => {
    void copyText(markdown).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const handlePrimaryAction = async () => {
    if (!primaryAction || actionBusy) return;
    setActionBusy(true);
    try {
      await primaryAction.onClick();
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-soft)]">
      <header className="flex min-h-11 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("plan.expand") : t("plan.collapse")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-transparent p-0 text-left text-sm font-semibold text-[var(--text)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-muted)]" aria-hidden="true"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /></svg>
          <span className="truncate">{title}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={collapsed ? t("plan.expand") : t("plan.collapse")} onClick={() => setCollapsed((value) => !value)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={collapsed ? "m9 18 6-6-6-6" : "m18 15-6-6-6 6"} /></svg>
          </IconButton>
          <IconButton label={t("plan.download")} onClick={() => downloadMarkdown(markdown, revision)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
          </IconButton>
          <IconButton label={copied ? t("i18n.copied") : t("plan.copy")} onClick={handleCopy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          </IconButton>
          {primaryAction && <button
            type="button"
            disabled={actionBusy}
            onClick={(event) => { event.stopPropagation(); void handlePrimaryAction(); }}
            className="ml-1 h-7 rounded-md bg-[var(--text)] px-2.5 text-xs font-medium text-[var(--bg-panel)] transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-55"
          >
            {primaryAction.label}
          </button>}
        </div>
      </header>
      {!collapsed && <div className="border-t border-[var(--border)] px-4 py-3">
        <MarkdownBody cwd={cwd} onOpenFile={onOpenFile} className="text-sm leading-6">{markdown}</MarkdownBody>
      </div>}
    </section>
  );
}
