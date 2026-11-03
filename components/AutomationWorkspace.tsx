"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon, FolderIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, StoreIcon, WorkflowIcon, XIcon } from "lucide-react";
import { AutomationAppManager, type AutomationAppManagerHandle, type AutomationAppMenuState } from "./AutomationAppManager";
import { AutomationAppImport, type AutomationAppImportHandle } from "./AutomationAppImport";
import { AutomationAppBrowserBridge } from "./AutomationAppBrowserBridge";
import type { AutomationAppDetailsRequest } from "./AutomationAppDetails";
import { AutomationStartPage } from "./AutomationStartPage";
import type { AutomationAppIndex } from "@/lib/automation-app";
import { getFrequentAutomationApps, readAutomationAppUsage, recordAutomationAppOpen, type AutomationAppUsage } from "@/lib/automation-app-usage";
import type { AutomationBrowserControls, AutomationTaskState } from "@/lib/automation-task-state";
import type { NativeBrowserSpec } from "@/lib/native-browser";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { useI18n } from "@/hooks/useI18n";
import { LabelTooltip } from "./LabelTooltip";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import sidebarStyles from "./InstalledCapabilitiesSidebar.module.css";
import styles from "./AutomationConversation.module.css";

type Props = { active: boolean; guest: boolean; cwd?:string; nativeSpec?: NativeBrowserSpec | null; nativeVisible?: boolean; taskState?: AutomationTaskState; browserControls?: RefObject<AutomationBrowserControls | null>; onOpenBrowser: (id: string, native?: NativeBrowserSpec) => void; onOpenDetails: (request: AutomationAppDetailsRequest) => void; onCloseDetails: () => void; onOpenMarket: () => void };
export function AutomationWorkspace(props: Props) {
  const { t } = useI18n();
  const translation = useRef(t); translation.current = t;
  const [selected, setSelected] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const [appIndex, setAppIndex] = useState<AutomationAppIndex | null>(null), [appError, setAppError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [appMenu, setAppMenu] = useState<AutomationAppMenuState | null>(null);
  const [appUsage, setAppUsage] = useState<{ ownerKey: string; entries: AutomationAppUsage }>({ ownerKey: "", entries: {} });
  const [source, setSource] = useState<"local" | "market">("local");
  const [query, setQuery] = useState(""), [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null), revealApp = useRef<string | null>(null);
  const manager = useRef<AutomationAppManagerHandle>(null);
  const importer = useRef<AutomationAppImportHandle>(null);
  const closeDetails = useRef(props.onCloseDetails); closeDetails.current = props.onCloseDetails;
  const selectedRevision = appIndex?.apps.find(app => selected === `app:${app.id}`)?.revision;
  useEffect(() => { closeDetails.current(); }, [selected, selectedRevision, props.guest, appIndex?.ownerKey, appIndex?.runtimeId]);
  useEffect(() => { if (searchOpen && props.active) searchRef.current?.focus(); }, [searchOpen, props.active]);
  useEffect(() => { if (!props.active) return; try { const id = sessionStorage.getItem("eureka:open-automation-app"); if (id) { sessionStorage.removeItem("eureka:open-automation-app"); revealApp.current = id; setSelected(`app:${id}`); setRefresh(n => n + 1); } } catch {} }, [props.active]);
  useEffect(() => {
    const app = appIndex?.apps.find(app => app.id === revealApp.current);
    if (!app) return;
    revealApp.current = null; setSource(app.managedPlugin ? "market" : "local"); setQuery(""); setSearchOpen(false);
  }, [appIndex, selected]);
  useEffect(() => {
    if (props.guest) { setAppIndex(null); setAppError(""); setSelected(null); setSource("local"); setQuery(""); setSearchOpen(false); revealApp.current = null; return; }
    if (!props.active) return;
    const abort = new AbortController(); setAppError("");
    void fetch(`/api/automation/apps${props.cwd?`?${new URLSearchParams({cwd:props.cwd})}`:""}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (typeof data.ownerKey !== "string" || typeof data.runtimeId !== "string" || !Array.isArray(data.apps) || !Array.isArray(data.data)) throw new Error(translation.current("automationUi.invalidDirectory"));
      if (!abort.signal.aborted) {
        const next = data as AutomationAppIndex;
        setAppIndex(next);
        // Validate selection against the fetched directory, not the previous snapshot:
        // a newly imported app may not exist in the old list yet.
        setSelected(current => current && next.apps.some(app => current === `app:${app.id}`) ? current : null);
        setAppMenu(current => current && next.apps.some(app => app.id === current.id) ? current : null);
        if (revealApp.current && !next.apps.some(app => app.id === revealApp.current)) revealApp.current = null;
      }
    }).catch(e => { if (!abort.signal.aborted) { setAppIndex(null); setAppError(e instanceof Error ? (e.name === "TimeoutError" ? translation.current("automationUi.directoryTimeout") : e.message) : translation.current("automationUi.directoryUnavailable")); } });
    return () => abort.abort();
  }, [props.active, props.guest, props.cwd, refresh]);
  useEffect(() => { if (!props.active || props.guest) return; const focus = () => setRefresh(n => n + 1); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [props.active, props.guest]);
  // Browsing installed apps must not pause the still-mounted homepage task.
  // Switching a running app's own bridge retains its existing scoped cleanup.
  function navigate(id: string | null, reveal = false) { revealApp.current = reveal && id?.startsWith("app:") ? id.slice(4) : null; setSelected(id); setRefresh(n => n + 1); }
  function create() { window.dispatchEvent(new CustomEvent("eureka:create-automation")); }
  function closeSearch() { setSearchOpen(false); setQuery(""); }
  const requestedAppId = selected?.startsWith("app:") ? selected.slice(4) : null;
  const selectedAppId = appIndex && !appIndex.apps.some(app => app.id === requestedAppId) ? null : requestedAppId;
  const ownerKey = appIndex?.ownerKey ?? "";
  useEffect(() => {
    if (!props.active || props.guest || !ownerKey) return;
    setAppUsage({ ownerKey, entries: selectedAppId ? recordAutomationAppOpen(ownerKey, selectedAppId) : readAutomationAppUsage(ownerKey) });
  }, [ownerKey, selectedAppId, props.active, props.guest]);
  const frequentApps = getFrequentAutomationApps(appIndex?.apps ?? [], appUsage.ownerKey === ownerKey ? appUsage.entries : {});
  const inSource = appIndex?.apps.filter(app => source === "market" ? Boolean(app.managedPlugin) : !app.managedPlugin) ?? [];
  const visibleApps = inSource.filter(app => `${app.displayName} ${app.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const [emptyBefore, emptyAfter] = t(source === "local" ? "automationUi.emptyCreateHint" : "automationUi.emptyMarketHint").split("{action}");
  return <div className={styles.workspace}>
    <AutomationAppBrowserBridge active={props.active && !props.guest} appId={selectedAppId} ownerKey={appIndex?.ownerKey ?? ""} runtimeId={appIndex?.runtimeId ?? ""} nativeSpec={props.nativeSpec} nativeVisible={props.nativeVisible} taskState={props.taskState} browserControls={props.browserControls} onOpenBrowser={props.onOpenBrowser} />
    <aside className={`${sidebarStyles.sidebar} ${styles.sidebar}`} aria-label={t("automationUi.sidebar")}>
      <div className={sidebarStyles.header}>
        <h2 className={styles.sidebarTitle}>{t("automationUi.title")}</h2>
        <div role="group" aria-label={t("automationUi.create")} className="inline-flex shrink-0 items-center rounded-[var(--radius-control)] border border-[var(--border)]">
          <LabelTooltip content={t("automationUi.create")}><Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-r-none" aria-label={t("automationUi.create")} disabled={props.guest} onClick={create}><PlusIcon size={15} aria-hidden="true" /></Button></LabelTooltip>
          <DropdownMenu><DropdownMenuTrigger disabled={props.guest} render={<Button variant="ghost" size="icon" className="h-7 w-5 rounded-l-none border-l border-[var(--border)]" aria-label={t("automationSettings.menu")} />}><ChevronDownIcon size={13} aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!appIndex || importBusy || applicationBusy} onClick={() => importer.current?.open()}>{t("automationSettings.import")}</DropdownMenuItem>
            <DropdownMenuItem disabled={importBusy} onClick={() => setRefresh(n => n + 1)}>{t("automationUi.refreshApps")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>
      </div>
      <Tabs value={source} onValueChange={value => setSource(value as "local" | "market")} className={sidebarStyles.scopes}>
        <TabsList className="grid h-[38px] w-full grid-cols-2" aria-label={t("automationUi.source")}>
          <TabsTrigger value="local" className={sidebarStyles.scopeTab}><FolderIcon size={14} aria-hidden="true" />{t("automationUi.myApps")}</TabsTrigger>
          <LabelTooltip content={t("automationUi.marketApps")}><TabsTrigger value="market" className={sidebarStyles.scopeTab} aria-label={t("automationUi.marketApps")}><StoreIcon size={14} aria-hidden="true" />{t("automationUi.marketTab")}</TabsTrigger></LabelTooltip>
        </TabsList>
      </Tabs>
      <div className={sidebarStyles.installedHeading}>{searchOpen ? <>
        <SearchIcon size={14} className={sidebarStyles.searchIcon} aria-hidden="true" />
        <input ref={searchRef} className={sidebarStyles.searchInput} aria-label={t("automationUi.search")} placeholder={t("automationUi.search")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} />
        <LabelTooltip content={t("chat.close")}><button type="button" className={sidebarStyles.iconButton} aria-label={t("automationUi.closeSearch")} onClick={closeSearch}><XIcon size={14} aria-hidden="true" /></button></LabelTooltip>
      </> : <>
        <h2>{t("extensions.installed")}<span className={sidebarStyles.count}>{appIndex ? visibleApps.length : "…"}</span></h2>
        <LabelTooltip content={t("automationUi.search")}><button type="button" className={sidebarStyles.iconButton} aria-label={t("automationUi.search")} aria-expanded={false} onClick={() => setSearchOpen(true)}><SearchIcon size={15} aria-hidden="true" /></button></LabelTooltip>
      </>}</div>
      <ul className={`${sidebarStyles.list} ${styles.toolList}`} aria-label={source === "local" ? t("automationUi.myApps") : t("automationUi.marketApps")}>{!props.guest && visibleApps.map(app => {
        const current = selectedAppId === app.id;
        const blocked = !props.active || importBusy || applicationBusy || !current || appMenu?.id !== app.id || appMenu?.blocked !== false;
        return <li className={styles.appEntry} key={app.id} data-selected={current}>
          <LabelTooltip content={app.displayName} side="right"><button type="button" className={`${sidebarStyles.item} ${styles.appSelect}`} aria-label={app.displayName} aria-current={current ? "page" : undefined} onClick={() => navigate(`app:${app.id}`)}>{app.managedPlugin ? <OrganizationCapabilityIcon capability={app.managedPlugin} size={17} /> : <WorkflowIcon size={17} aria-hidden="true" />}<span className={sidebarStyles.name}>{app.displayName}</span></button></LabelTooltip>
          <DropdownMenu onOpenChange={open => { if (open && !current) navigate(`app:${app.id}`); }}>
            <DropdownMenuTrigger disabled={!props.active || importBusy || applicationBusy} render={<Button variant="ghost" size="icon" className={styles.appMenu} aria-label={t("automationUi.moreActions", { name: app.displayName })} />}><MoreHorizontalIcon size={15} /></DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              <DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("history",app.id)}>{t("automationUi.history")}</DropdownMenuItem>
              <DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("refresh",app.id)}>{t("automationUi.refreshHistory")}</DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("info",app.id)}>{t("automationUi.details")}</DropdownMenuItem>
              {app.managedPlugin&&<DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("save-as",app.id)}>{t("automationUi.saveAs")}</DropdownMenuItem>}
              {!app.managedPlugin&&<><DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("modify",app.id)}>{t("automationUi.modify")}</DropdownMenuItem><DropdownMenuItem disabled={blocked} onClick={() => manager.current?.perform("export",app.id)}>{t("automationUi.export")}</DropdownMenuItem></>}
              <DropdownMenuSeparator/>
              <DropdownMenuItem disabled={blocked} variant="destructive" onClick={() => manager.current?.perform("clear-data",app.id)}>{t("automationUi.clear")}</DropdownMenuItem>
              {!app.managedPlugin&&<DropdownMenuItem disabled={blocked} variant="destructive" onClick={() => manager.current?.perform("uninstall",app.id)}>{t("automationUi.uninstallApp")}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>;
      })}{appIndex && !visibleApps.length && <li className={sidebarStyles.empty}>{query.trim() && inSource.length ? t("extensions.noMatches") : <>{emptyBefore}<Button variant="link" size="sm" className="h-auto p-0 text-xs font-normal underline underline-offset-4" onClick={source === "local" ? create : props.onOpenMarket}>{t(source === "local" ? "automationUi.createLink" : "automationUi.marketLink")}</Button>{emptyAfter}</>}</li>}</ul>
    </aside>
    <div className={styles.main}>
      {appError && <p className={styles.error} role="alert">{appError}</p>}{props.guest && <p className={styles.notice}>{t("automationUi.signIn")}</p>}
      {selectedAppId && !props.guest && (appIndex ? <AutomationAppManager ref={manager} key={`${appIndex.ownerKey}:${appIndex.runtimeId}`} index={appIndex} selected={selectedAppId} active={props.active} cwd={props.cwd} onSelect={(id,reveal) => navigate(id ? `app:${id}` : null,reveal)} onChanged={() => setRefresh(n => n + 1)} onRunningChange={setApplicationBusy} onMenuStateChange={setAppMenu} onOpenDetails={props.onOpenDetails} /> : !appError && <p className={styles.notice}>{t("automationUi.loadingDirectory")}</p>)}
      {!selectedAppId && !props.guest && <AutomationStartPage apps={frequentApps} loading={!appIndex && !appError} importDisabled={!appIndex || importBusy || applicationBusy} onCreate={create} onImport={() => importer.current?.open()} onOpen={id => navigate(`app:${id}`, true)} />}
    </div>
    {appIndex && !props.guest && <AutomationAppImport key={`${appIndex.ownerKey}:${appIndex.runtimeId}`} ref={importer} index={appIndex} active={props.active} onBusyChange={setImportBusy} onInstalled={id => navigate(`app:${id}`, true)} />}
  </div>;
}
