"use client";

import { ExtensionErrorText } from "./ExtensionNotice";

import { useId } from "react";
import { ArrowUpRightIcon, CircleHelpIcon, DownloadIcon, FolderIcon, GlobeIcon, LayersIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { SkillInstallScope, SkillSearchResult } from "@/lib/api-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ExtensionNotice as NotificationNotice } from "./ExtensionNotice";
import type { Ref } from "react";

export function MarketSkillSearch({ query, results, searching, searched, searchError, installError, installing, scope, installPath, inputRef, isInstalled, onQueryChange, onSearch, onInstall, onManage }: {
  query: string;
  results: SkillSearchResult[];
  searching: boolean;
  searched: boolean;
  searchError: string | null;
  installError: string | null;
  installing: string | null;
  scope: SkillInstallScope;
  installPath: string;
  inputRef: Ref<HTMLInputElement>;
  isInstalled: (pkg: string) => boolean;
  onQueryChange: (value: string) => void;
  onSearch: (value: string) => Promise<void>;
  onInstall: (pkg: string) => Promise<void>;
  onManage?: (pkg: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const inputId = useId();
  return <div data-market-skill-search="" className="@container flex h-full min-h-[420px] w-full flex-col text-[13px] text-[var(--text)]">
    <div className="mb-5 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold">{t("extensions.skillSearchTitle")}</h2>
      <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] px-2 text-[12px] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">{t("extensions.skillDirectory")}<ArrowUpRightIcon size={14} aria-hidden="true" /></a>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">{t("extensions.skillSearchDescription")}</p>
    </div>
    <div className="shrink-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4 @min-[480px]:p-5">
      <label htmlFor={inputId} className="mb-2 block font-medium">{t("extensions.skillSearchLabel")}</label>
      <div className="flex flex-col items-start gap-2 @min-[480px]:flex-row @min-[480px]:items-center">
        <div className="relative w-full min-w-0 @min-[480px]:flex-1"><SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" /><Input id={inputId} ref={inputRef} value={query} onChange={event => onQueryChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && query.trim() && !searching) { event.preventDefault(); void onSearch(query); } }} autoComplete="off" spellCheck={false} placeholder={t("i18n.skillSearchPlaceholder")} className="h-[36px] min-w-0 w-full bg-[var(--bg-panel)] pl-9 text-[13px] transition-[border-color,box-shadow] focus-visible:border-[color-mix(in_srgb,var(--text-muted)_55%,var(--border))] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text)_8%,transparent)]" /></div>
        <Button type="button" size="sm" className="h-[36px] shrink-0 gap-1.5 text-[13px]" disabled={searching || !query.trim()} onClick={() => void onSearch(query)}><SearchIcon size={15} aria-hidden="true" />{t(searching ? "i18n.searching" : "i18n.search")}</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">{scope === "global" ? <GlobeIcon size={14} aria-hidden="true" /> : <FolderIcon size={14} aria-hidden="true" />}{t(scope === "global" ? "extensions.pluginDestinationGlobal" : "extensions.pluginDestinationProject")}</span>
        <Tooltip><TooltipTrigger render={<button type="button" className="inline-flex items-center gap-1 rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] @min-[480px]:ml-auto">{t("extensions.pluginInstallLocation")}<CircleHelpIcon size={13} aria-hidden="true" /></button>} /><TooltipContent className="break-all font-mono">{installPath}</TooltipContent></Tooltip>
      </div>
    </div>
    <div data-market-skill-results="" role="region" aria-label={t("extensions.skillResults")} tabIndex={0} className="mt-4 min-h-[160px] flex-1 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4 focus-visible:outline-2 focus-visible:outline-[var(--accent)] @min-[480px]:px-5" aria-busy={searching}>
      {searching ? <div role="status" aria-label={t("i18n.searching")} className="flex flex-col gap-4">{[0, 1, 2, 3].map(index => <div key={index} className="flex items-center gap-3 border-b border-[var(--border)] pb-4"><Skeleton className="h-8 w-8 shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-44 max-w-full" /></div><Skeleton className="h-[30px] w-16" /></div>)}</div>
        : searchError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-[var(--text-muted)]"><div className="min-w-0 break-words"><ExtensionErrorText error={searchError} /></div><Button type="button" variant="outline" size="sm" onClick={() => void onSearch(query)} disabled={!query.trim()}>{t("context.retry")}</Button></div>
        : results.length ? <><p className="mb-1 text-[12px] text-[var(--text-muted)]" role="status">{t("extensions.skillResultCount", { count: results.length })}</p><div aria-label={t("extensions.skillResults")}>{results.map(result => {
          const at = result.package.indexOf("@");
          const repo = at > -1 ? result.package.slice(0, at) : result.package;
          const name = at > -1 ? result.package.slice(at + 1) : repo;
          const installed = isInstalled(result.package);
          const busy = installing === result.package;
          return <div key={result.package} data-market-skill-result="" className="flex min-w-0 items-center gap-3 border-b border-[var(--border)] py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-selected)] text-[var(--text-muted)]"><LayersIcon size={17} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><h3 className="mb-1 break-all text-[14px] font-medium">{name}</h3><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-muted)]"><code className="break-all text-[12px]">{repo}</code><span>{t("extensions.skillInstallCount", { count: result.installs.replace(/\s+installs?$/i, "") })}</span>{result.url ? <Tooltip><TooltipTrigger render={<a href={result.url} target="_blank" rel="noopener noreferrer" aria-label={t("extensions.skillExternalDetails", { name })} className="rounded-sm hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ArrowUpRightIcon size={14} aria-hidden="true" /></a>} /><TooltipContent>{t("extensions.skillExternalDetails", { name })}</TooltipContent></Tooltip> : null}</div></div>
            <Button type="button" size="sm" className={`h-[30px] shrink-0 gap-1.5 text-[12px] ${installed && onManage ? "bg-blue-500 text-white hover:bg-blue-600" : ""}`} disabled={installing !== null || installed && !onManage} onClick={() => { if (installed) void onManage?.(result.package); else void onInstall(result.package); }}>{installed && onManage ? <SlidersHorizontalIcon size={14} aria-hidden="true" /> : <DownloadIcon size={14} aria-hidden="true" />}{t(installed ? onManage ? "extensions.manage" : "i18n.installed" : busy ? "i18n.installing" : "i18n.install")}</Button>
          </div>;
        })}</div></>
        : <div className="py-8 text-center"><span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-selected)] text-[var(--text-muted)]"><SearchIcon size={18} aria-hidden="true" /></span><h3 className="mb-1 text-[14px] font-medium">{t(searched ? "extensions.skillNoResults" : "extensions.skillDiscover")}</h3><p className="text-[12px] text-[var(--text-muted)]">{t(searched ? "extensions.skillTryAnotherQuery" : "extensions.skillSearchPrompt")}</p></div>}
    </div>
    {installError ? <NotificationNotice type="error" message={installError} /> : null}
  </div>;
}
