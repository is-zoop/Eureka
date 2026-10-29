"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, CpuIcon, FolderIcon, GlobeIcon, LayersIcon, PlugIcon, SearchIcon, XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { McpServersResponse, PluginsResponse, SkillsResponse } from "@/lib/api-types";
import { mergeInstalledCapabilities, type InstalledCapability, type ManagedCapabilityInstall } from "@/lib/installed-capabilities";
import { getFileName } from "@/lib/file-paths";
import { Skeleton } from "./ui/skeleton";
import { LabelTooltip } from "./LabelTooltip";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import styles from "./InstalledCapabilitiesSidebar.module.css";

export type ExtensionSource = "organization" | "market";
export type ExtensionSection = "skills" | "plugins" | "mcp";

export function InstalledCapabilitiesSidebar({ cwd, sessionId, active = true, revision = 0, selectedKey, onSelect, source, section, guest = false, onSourceChange, onSectionChange, browsing = true, scope, onScopeChange }: {
  cwd: string; sessionId: string | null; active?: boolean; revision?: number;
  selectedKey?: string; onSelect: (item: InstalledCapability) => void;
  source: ExtensionSource; section: ExtensionSection; guest?: boolean; browsing?: boolean;
  onSourceChange: (source: ExtensionSource) => void; onSectionChange: (section: ExtensionSection) => void;
  scope: "global" | "project"; onScopeChange: (scope: "global" | "project") => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<InstalledCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen, expanded]);
  const closeSearch = () => { setSearchOpen(false); setQuery(""); };
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    setLoading(true);
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<T>;
    };
    const params = new URLSearchParams({ cwd });
    const results = await Promise.allSettled([
      read<SkillsResponse>(`/api/skills?${params}`),
      read<PluginsResponse>(`/api/plugins?${params}`),
      read<McpServersResponse>(`/api/mcp/servers?${params}&scope=global`),
      read<McpServersResponse>(`/api/mcp/servers?${params}&scope=project`),
      ...(["global", "project"] as const).flatMap(scope => (["skill", "plugin", "mcp"] as const).map(type => read<{ items: ManagedCapabilityInstall[] }>(`/api/organization-extensions/installations?${new URLSearchParams({ cwd, scope, type, ...(sessionId ? { sessionId } : {}) })}`))),
    ]);
    if (controller.signal.aborted) return;
    const [skills, plugins, globalMcp, projectMcp, ...managed] = results;
    setItems(mergeInstalledCapabilities({
      skills: skills.status === "fulfilled" ? skills.value.installedSkills ?? skills.value.skills ?? [] : [],
      packages: plugins.status === "fulfilled" ? plugins.value.packages ?? [] : [],
      mcp: [globalMcp, projectMcp].flatMap(result => result.status === "fulfilled" ? [result.value as McpServersResponse] : []),
      managed: managed.flatMap(result => result.status === "fulfilled" ? (result.value as { items?: ManagedCapabilityInstall[] }).items ?? [] : []),
    }));
    setFailed(results.some(result => result.status === "rejected"));
    setLoading(false);
  }, [cwd, sessionId]);
  useEffect(() => {
    if (!active) return;
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    return () => { controllerRef.current?.abort(); window.removeEventListener("focus", refresh); };
  }, [active, load, revision]);
  const originLabel = (item: InstalledCapability) => t(item.origin === "organization" ? "extensions.installedSourceOrganization" : item.origin === "market" ? "extensions.installedSourceMarket" : "extensions.installedSourceLocal");
  const scopeLabel = (item: InstalledCapability) => t(item.scope === "project" ? "extensions.project" : item.scope === "global" ? "extensions.global" : "extensions.installedSourcePath");
  const categories = [
    { section: "plugins", kind: "Plugin", Icon: PlugIcon, label: t("extensions.plugins") },
    { section: "skills", kind: "Skill", Icon: LayersIcon, label: t("extensions.skills") },
    { section: "mcp", kind: "MCP", Icon: CpuIcon, label: t("extensions.mcp") },
  ] as const;
  const current = categories.find(category => category.section === section)!;
  const inSource = items.filter(item => source === "organization" ? item.origin === "organization" : item.origin !== "organization");
  const visible = inSource.filter(item => item.scope === scope && item.kind === current.kind && `${item.name} ${originLabel(item)} ${scopeLabel(item)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <aside className={styles.sidebar} data-expanded={expanded} aria-label={t("extensions.installedCapabilities")} data-installed-capabilities>
    <header className={styles.header}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className={styles.source} aria-label={t("extensions.source")} />}>
          <span className={styles.sourceLabel}>{t(source === "organization" ? "extensions.organization" : "extensions.market")}</span><ChevronDownIcon size={16} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-48">
          {(["organization", "market"] as const).map(value => <DropdownMenuItem key={value} disabled={value === "organization" && guest} title={value === "organization" && guest ? t("extensions.loginRequired") : undefined} onClick={() => onSourceChange(value)} className={source === value ? "bg-[var(--bg-selected)]" : undefined}>{t(value === "organization" ? "extensions.organization" : "extensions.market")}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      {scope === "project" && <LabelTooltip content={cwd}><span className={styles.projectName}>{getFileName(cwd) || cwd}</span></LabelTooltip>}
      <button type="button" className={styles.toggle} aria-label={t("extensions.toggleNavigation")} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}><ChevronDownIcon size={16} aria-hidden="true" /></button>
    </header>
    <div id={listId} className={styles.body}>
      <Tabs value={scope} onValueChange={value => onScopeChange(value as "global" | "project")} className={styles.scopes}>
        <TabsList className="grid h-[38px] w-full grid-cols-2" aria-label={t("extensions.installScope")}>
          <TabsTrigger value="global" className={styles.scopeTab}><GlobeIcon size={14} aria-hidden="true" />{t("extensions.global")}</TabsTrigger>
          <TabsTrigger value="project" className={styles.scopeTab}><FolderIcon size={14} aria-hidden="true" />{t("extensions.project")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <nav className={styles.categories} aria-label={t("extensions.category")}>
        {categories.map(({ section: value, Icon, label }) => <button type="button" key={value} className={styles.category} aria-pressed={browsing && section === value} onClick={() => onSectionChange(value)}><Icon size={18} aria-hidden="true" />{label}</button>)}
      </nav>
      <div className={styles.installedHeading}>
        {searchOpen ? <>
          <SearchIcon size={14} className={styles.searchIcon} aria-hidden="true" />
          <input ref={searchRef} className={styles.searchInput} aria-label={t("extensions.searchInstalled")} placeholder={t("extensions.searchInstalled")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} />
          <LabelTooltip content={t("chat.close")}><button type="button" className={styles.iconButton} aria-label={t("chat.close")} onClick={closeSearch}><XIcon size={14} aria-hidden="true" /></button></LabelTooltip>
        </> : <>
          <h2>{t("extensions.installed")}<span className={styles.count}>{visible.length}</span></h2>
          <LabelTooltip content={t("extensions.searchInstalled")}><button type="button" className={styles.iconButton} aria-label={t("extensions.searchInstalled")} aria-expanded={false} onClick={() => setSearchOpen(true)}><SearchIcon size={15} aria-hidden="true" /></button></LabelTooltip>
        </>}
      </div>
      <div className={styles.list} aria-busy={loading}>
        {failed && <p role="status" className={styles.empty}>{t("extensions.installedPartialFailure")}</p>}
        {loading && !items.length ? <div className="space-y-3 p-2" aria-label={t("extensions.installedLoading")}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-[var(--radius-control)]" />)}</div> : !visible.length ? <p className={styles.empty}>{t(query ? "extensions.noMatches" : "extensions.noInstalledCapabilities")}</p> : <ul className={styles.items}>{visible.map(item => <li key={item.key}><LabelTooltip content={item.name} side="right"><button type="button" className={styles.item} aria-label={item.name} aria-pressed={item.key === selectedKey} onClick={() => { onSelect(item); setExpanded(false); }}>{item.target.type === "organization" ? <OrganizationCapabilityIcon capability={{ capabilityId: item.target.install.capabilityId }} type={item.kind} size={17} className="text-[var(--text-muted)]" /> : <current.Icon size={17} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />}<span className="min-w-0 flex-1"><span className={styles.name}>{item.name}</span></span></button></LabelTooltip></li>)}</ul>}
      </div>
    </div>
  </aside>;
}
