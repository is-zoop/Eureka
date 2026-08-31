"use client";

import Link from "next/link";
import { useState } from "react";
import { ModelsConfig } from "@/components/ModelsConfig";
import { useI18n } from "@/hooks/useI18n";
import { type ThemePreference, useTheme } from "@/hooks/useTheme";

type SettingsSection = "system" | "models";

function SettingsIcon({ section }: { section: SettingsSection }) {
  return section === "system" ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></svg>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "dark") return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>;
  if (preference === "auto") return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
}

export function SettingsPage({ onBack }: { onBack?: () => void }) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setPreference } = useTheme();
  const [section, setSection] = useState<SettingsSection>("system");
  const sections: { id: SettingsSection; label: string }[] = [
    { id: "system", label: t("settings.system") },
    { id: "models", label: t("settings.models") },
  ];

  return (
    <main className="flex h-full min-h-0 bg-[var(--chat-bg)] text-[var(--text)]">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] p-3 max-sm:w-48">
        {onBack ? (
          <button type="button" onClick={onBack} className="mb-6 inline-flex h-8 items-center gap-2 rounded-[var(--radius-control)] border-0 bg-transparent px-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <span aria-hidden="true">←</span>{t("settings.backToApp")}
          </button>
        ) : (
          <Link href="/" className="mb-6 inline-flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <span aria-hidden="true">←</span>{t("settings.backToApp")}
          </Link>
        )}
        <p className="mb-2 px-2 text-xs font-medium text-[var(--text-muted)]">{t("settings.personal")}</p>
        <nav className="flex flex-col gap-1" aria-label={t("settings.title")}>
          {sections.map((item) => {
            const active = section === item.id;
            return <button key={item.id} type="button" onClick={() => setSection(item.id)} className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-sm transition-colors" style={{ background: active ? "color-mix(in srgb, var(--text) 9%, var(--sidebar-bg))" : "transparent", color: "var(--text)" }} onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = "color-mix(in srgb, var(--text) 6%, var(--sidebar-bg))"; }} onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = "transparent"; }}><SettingsIcon section={item.id} />{item.label}</button>;
          })}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto bg-[var(--chat-bg)]">
        {section === "system" ? (
          <div className="mx-auto w-full max-w-4xl px-8 py-12 max-sm:px-5 max-sm:py-8">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{t("settings.system")}</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("settings.systemDescription")}</p>
            <div className="mt-9 space-y-7">
              <section><h2 className="mb-3 text-base font-semibold">{t("settings.appearance")}</h2><div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-2"><div className="grid grid-cols-3 gap-2">{(["light", "dark", "auto"] as ThemePreference[]).map((item) => <button key={item} type="button" onClick={() => setPreference(item)} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-sm transition-colors" style={{ background: preference === item ? "var(--bg-selected)" : "transparent", color: "var(--text)" }} onMouseEnter={(event) => { if (preference !== item) event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { if (preference !== item) event.currentTarget.style.background = "transparent"; }}><ThemeIcon preference={item} /><span>{t(`settings.theme.${item}`)}</span></button>)}</div></div></section>
              <section><h2 className="mb-3 text-base font-semibold">{t("settings.language")}</h2><div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3"><label className="flex items-center justify-between gap-5 text-sm"><span><span className="block font-medium">{t("settings.displayLanguage")}</span><span className="mt-1 block text-xs text-[var(--text-muted)]">{t("settings.languageDescription")}</span></span><select value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} className="h-9 shrink-0 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">{supportedLocales.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.label}</option>)}</select></label></div></section>
            </div>
          </div>
        ) : <ModelsConfig embedded onClose={() => setSection("system")} />}
      </section>
    </main>
  );
}
