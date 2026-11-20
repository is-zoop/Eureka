"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "../../../components/ui/button";
import { SettingsCard } from "../../../components/SettingsLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../../components/ui/tabs";
const panelClassName = "mt-3 h-[144px] max-h-[24dvh] min-h-0 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] p-4 text-xs leading-5 text-[var(--text-muted)] [scrollbar-gutter:stable]";

export function PackageReleaseNotes({ identity, version, cwd, source, scope, enabled, children }: { identity: string; version?: string; cwd: string; source: string; scope: string; enabled: boolean; children: ReactNode }) {
  const { t } = useI18n(); const [unread, setUnread] = useState(false);
  const [tab, setTab] = useState("overview"), [text, setText] = useState<string | null | undefined>(), [error, setError] = useState(false);
  useEffect(() => { setText(undefined); setError(false); }, [identity, version]);
  useEffect(() => {
    if (tab !== "updates" || !enabled) return;
    const controller = new AbortController(); setError(false);
    void fetch(`/api/plugins?${new URLSearchParams({ cwd, notesSource: source, notesScope: scope })}`, { signal: controller.signal, cache: "no-store" }).then(async r => { if (!r.ok) throw Error(); const data = await r.json(); if (!controller.signal.aborted) setText(data.notes); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [tab, cwd, source, scope, enabled, version]);
  const key = `eureka-package-read:${identity}`;
  useEffect(() => { setUnread(false); if (!version) return; try { const read = localStorage.getItem(key); if (read === null) localStorage.setItem(key, version); else setUnread(read !== version); } catch {} }, [key, version]);
  if (!enabled) return <details data-market-install-details className="mt-4 shrink-0 border-t border-[var(--border)] pt-3 text-xs"><summary>{t("extensions.marketInstallDetails")}</summary><SettingsCard className={panelClassName}>{children}</SettingsCard></details>;
  return <Tabs className="mt-4 shrink-0 border-t border-[var(--border)] pt-3" value={tab} onValueChange={setTab}>
    <TabsList className="h-8">
      <TabsTrigger className="h-6 text-xs" value="overview">{t("extensions.marketInstallDetails")}</TabsTrigger>
      <TabsTrigger className="h-6 text-xs" value="updates">{t("sdk.updates")}{unread ? ` · ${t("sdk.unread")}` : ""}</TabsTrigger>
    </TabsList>
    <SettingsCard key={tab} className={panelClassName}>
      <TabsContent value="overview">{children}</TabsContent>
      <TabsContent value="updates">
        <p role={error ? "alert" : undefined} className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {error ? t("sdk.error") : text === undefined ? "…" : text?.trim() ? text : t("sdk.noUpdates")}
        </p>
        {!error && Boolean(text?.trim()) && unread && <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => {
            try { if (version) localStorage.setItem(key, version); setUnread(false); } catch {}
          }}>{t("sdk.read")}</Button>
        </div>}
      </TabsContent>
    </SettingsCard>
  </Tabs>;
}
