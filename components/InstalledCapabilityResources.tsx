"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ClockIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { rewriteDocumentImages, versionNotes } from "@/lib/organization-extension-content";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

type DocumentTab = "quickStart" | "readme";
type DocumentResponse = { key: string; state: "loading" | "ready" | "error"; content: string | null; basePath: string };

function CapabilityDocument({ capabilityId, tab }: { capabilityId: string; tab: DocumentTab }) {
  const { t } = useI18n();
  const file = tab === "quickStart" ? "quick_start.md" : "README.md";
  const requestKey = `${capabilityId}:${file}`;
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<DocumentResponse>({ key: "", state: "loading", content: null, basePath: "" });
  const state = response.key === requestKey ? response.state : "loading";
  useEffect(() => {
    const controller = new AbortController();
    setResponse({ key: requestKey, state: "loading", content: null, basePath: "" });
    void fetch(`/api/organization-extensions/${encodeURIComponent(capabilityId)}/content?file=${file}`, { signal: controller.signal, cache: "no-store" })
      .then(async result => {
        const payload = await result.json().catch(() => null) as { content?: string | null; basePath?: string } | null;
        if (!result.ok) throw new Error("content");
        if (!controller.signal.aborted) setResponse({ key: requestKey, state: "ready", content: payload?.content ?? null, basePath: payload?.basePath ?? "" });
      })
      .catch(() => { if (!controller.signal.aborted) setResponse({ key: requestKey, state: "error", content: null, basePath: "" }); });
    return () => controller.abort();
  }, [capabilityId, file, requestKey, revision]);
  return <div data-capability-document className="min-h-48 min-w-0" aria-busy={state === "loading"}>
    {state === "loading" ? <div className="space-y-3 py-2" role="status" aria-label={t("extensions.contentLoading")}><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>
      : state === "error" ? <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--text-muted)]"><p>{t("extensions.contentFailed")}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>{t("context.retry")}</Button></div>
      : response.content?.trim() ? <MarkdownBody className="text-sm" isStreaming={false}>{rewriteDocumentImages(response.content, capabilityId, response.basePath)}</MarkdownBody>
      : <p className="grid min-h-48 place-items-center text-sm text-[var(--text-muted)]">{t("extensions.noContent")}</p>}
  </div>;
}

export function InstalledCapabilityResources({ item }: { item: Pick<OrganizationExtensionDetailItem, "id" | "versionHistory"> }) {
  const { t, locale } = useI18n();
  const id = useId();
  const [tab, setTab] = useState<DocumentTab>("quickStart");
  const versions = useMemo(() => [...item.versionHistory].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)), [item.versionHistory]);
  const formatDate = (value: string) => {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? "—" : new Date(timestamp).toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  };
  return <div data-installed-resources className="@container mt-6 flex min-h-0 flex-1 flex-col">
    <div className="grid min-h-0 min-w-0 flex-1 auto-rows-[420px] grid-cols-1 gap-4 min-[960px]:@min-[640px]:auto-rows-[minmax(240px,1fr)] @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(200px,0.4fr)]">
      <section data-resource-panel="documentation" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)]" aria-label={t("extensions.documentation")}>
        <Tabs value={tab} onValueChange={value => setTab(value as DocumentTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center border-b border-[var(--border)] px-3">
          <TabsList className="h-[36px]" aria-label={t("extensions.documentation")} onKeyDown={event => {
            const options: DocumentTab[] = ["quickStart", "readme"];
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? options[0] : event.key === "End" ? options[1] : options[1 - options.indexOf(tab)];
            setTab(next);
            document.getElementById(`${id}-${next}`)?.focus();
          }}>
            {(["quickStart", "readme"] as const).map(value => <TabsTrigger key={value} value={value} id={`${id}-${value}`} aria-controls={`${id}-document`} tabIndex={tab === value ? 0 : -1} className="h-[28px] text-[13px]">{t(value === "quickStart" ? "extensions.quickStart" : "extensions.documentation")}</TabsTrigger>)}
          </TabsList>
          </div>
          <div role="tabpanel" id={`${id}-document`} aria-labelledby={`${id}-${tab}`} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain break-words px-3 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]">
            <CapabilityDocument capabilityId={item.id} tab={tab} />
          </div>
        </Tabs>
      </section>
      <section data-capability-version-history data-resource-panel="history" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)]" aria-label={t("extensions.versionHistory")}>
        <h3 className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-sm font-semibold"><ClockIcon size={14} className="text-[var(--text-muted)]" aria-hidden="true" />{t("extensions.versionHistory")}</h3>
        <div data-version-history-scroll tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]">
        {versions.length ? <ol className="divide-y divide-[var(--border)]">{versions.map((version, index) => {
          const notes = versionNotes(version.changelog);
          return <li key={`${version.version}-${version.createdAt}-${index}`} className="relative py-4 pl-4 first:pt-0">
            <span aria-hidden="true" className={`absolute left-0 h-1.5 w-1.5 rounded-full bg-[var(--text-dim)] ${index === 0 ? "top-1.5" : "top-[22px]"}`} />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="break-all text-sm font-medium">V{version.version.trim().replace(/^v/i, "")}</span><time className="text-xs text-[var(--text-dim)]">{formatDate(version.createdAt)}</time></div>
            {notes.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--text-muted)]">{notes.map((note, noteIndex) => <li key={noteIndex} className="break-words">{note}</li>)}</ul> : <p className="mt-2 text-xs text-[var(--text-muted)]">{t("extensions.noVersionNotes")}</p>}
          </li>;
        })}</ol> : <p className="text-xs leading-5 text-[var(--text-muted)]">{t("extensions.noVersionHistory")}</p>}
        </div>
      </section>
    </div>
  </div>;
}
