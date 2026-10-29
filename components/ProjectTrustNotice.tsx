"use client";

import { useI18n } from "@/hooks/useI18n";

export function ProjectTrustNotice({ kind, onTrustProject }: { kind: "skills" | "plugins"; onTrustProject?: () => void }) {
  const { t } = useI18n();
  return <div role="status" className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-[18px] py-2 text-[12px] leading-6 text-[var(--text-muted)]">
    <span>{t(kind === "skills" ? "trust.skillsNotLoaded" : "trust.pluginsNotLoaded")}</span>
    {onTrustProject ? <> {t("trust.installBefore")}<button type="button" aria-label={t("trust.trustProject")} className="inline cursor-pointer border-0 bg-transparent p-0 align-baseline text-red-600 underline underline-offset-2 hover:text-red-700 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:text-red-400 dark:hover:text-red-300" onClick={onTrustProject}>{t("trust.inlineAction")}</button>{t("trust.installAfter")}</> : null}
  </div>;
}
