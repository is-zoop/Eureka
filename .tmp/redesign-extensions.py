from pathlib import Path

root = Path('E:/Eureka')
def read(name): return (root/name).read_text(encoding='utf-8')
def write(name, value): (root/name).write_text(value, encoding='utf-8')

p='components/InstalledCapabilitiesSidebar.tsx'
s=read(p)
start=s.index('  const visible = items.filter')
s=s[:start]+'''  const categories = [
    { section: "plugins", kind: "Plugin", Icon: PackagePlusIcon, label: t("extensions.plugins") },
    { section: "skills", kind: "Skill", Icon: LayersIcon, label: t("extensions.skills") },
    { section: "mcp", kind: "MCP", Icon: CpuIcon, label: t("extensions.mcp") },
  ] as const;
  const current = categories.find(category => category.section === section)!;
  const inSource = items.filter(item => source === "organization" ? item.origin === "organization" : item.origin !== "organization");
  const visible = inSource.filter(item => item.kind === current.kind && `${item.name} ${originLabel(item)} ${scopeLabel(item)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <aside className={styles.sidebar} data-expanded={expanded} aria-label={t("extensions.installedCapabilities")} data-installed-capabilities>
    <header className={styles.header}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className={styles.source} aria-label={t("extensions.source")} />}>
          {t(source === "organization" ? "extensions.organization" : "extensions.market")}<ChevronDownIcon size={16} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-48">
          {(["organization", "market"] as const).map(value => <DropdownMenuItem key={value} disabled={value === "organization" && guest} title={value === "organization" && guest ? t("extensions.loginRequired") : undefined} onClick={() => onSourceChange(value)} className={source === value ? "bg-[var(--bg-selected)]" : undefined}>{t(value === "organization" ? "extensions.organization" : "extensions.market")}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <LabelTooltip content={t("extensions.searchInstalled")}><button type="button" className={styles.refresh} aria-label={t("extensions.searchInstalled")} aria-expanded={searchOpen} onClick={() => { setSearchOpen(value => !value); setExpanded(true); }}><SearchIcon size={17} aria-hidden="true" /></button></LabelTooltip>
      <button type="button" className={styles.toggle} aria-label={t("extensions.toggleNavigation")} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}><ChevronDownIcon size={16} aria-hidden="true" /></button>
    </header>
    <div id={listId} className={styles.body}>
      {searchOpen && <div className={styles.search}><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" /><Input autoFocus aria-label={t("extensions.searchInstalled")} placeholder={t("extensions.searchInstalled")} value={query} onChange={event => setQuery(event.target.value)} className="h-8 bg-[var(--bg-panel)] pl-8 text-xs" /></div>}
      <nav className={styles.categories} aria-label={t("extensions.category")}>
        {categories.map(({ section: value, Icon, label }) => <button type="button" key={value} className={styles.category} aria-pressed={section === value} onClick={() => onSectionChange(value)}><Icon size={18} aria-hidden="true" />{label}</button>)}
      </nav>
      <div className={styles.installedHeading}><h2>{t("extensions.installed")}<span className={styles.count}>{visible.length}</span></h2><LabelTooltip content={t("extensions.refreshInstalled")}><button type="button" className={styles.refresh} aria-label={t("extensions.refreshInstalled")} disabled={loading} onClick={() => void load()}><RefreshCwIcon size={14} aria-hidden="true" /></button></LabelTooltip></div>
      <div className={styles.list} aria-busy={loading}>
        {failed && <p role="status" className={styles.empty}>{t("extensions.installedPartialFailure")}</p>}
        {loading && !items.length ? <div className="space-y-3 p-2" aria-label={t("extensions.installedLoading")}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-[var(--radius-control)]" />)}</div> : !visible.length ? <p className={styles.empty}>{t(query ? "extensions.noMatches" : "extensions.noInstalledCapabilities")}</p> : <ul className={styles.items}>{visible.map(item => <li key={item.key}><LabelTooltip content={`${item.name} · ${originLabel(item)} · ${scopeLabel(item)}`} side="right"><button type="button" className={styles.item} aria-label={item.name} aria-pressed={item.key === selectedKey} onClick={() => { onSelect(item); setExpanded(false); }}><current.Icon size={17} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" /><span className="min-w-0 flex-1"><span className={styles.name}>{item.name}</span><span className={styles.metadata}>{originLabel(item)} · {scopeLabel(item)}{item.disabled ? ` · ${t("i18n.disabled")}` : ""}</span></span></button></LabelTooltip></li>)}</ul>}
      </div>
    </div>
  </aside>;
}
'''
write(p,s)
write('components/InstalledCapabilitiesSidebar.module.css','''.workspace { display: flex; height: 100%; min-height: 0; overflow: hidden; background: var(--chat-bg); color: var(--text); }
.sidebar { display: flex; flex: 0 0 240px; flex-direction: column; width: 240px; min-height: 0; border-right: 1px solid var(--border); background: var(--sidebar-content-bg); }
.header { display: flex; flex-shrink: 0; align-items: center; gap: 4px; min-height: 64px; padding: 12px; }
.source { display: inline-flex; min-width: 0; flex: 1; align-items: center; gap: 6px; padding: 4px; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); text-align: left; font-size: 18px; font-weight: 600; cursor: pointer; }
.source svg { flex-shrink: 0; color: var(--text-muted); }
.toggle, .refresh { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text-muted); cursor: pointer; }
.toggle { display: none; width: 28px; height: 28px; }
.refresh { width: 28px; height: 28px; }
.refresh:hover, .toggle:hover, .source:hover { background: var(--bg-hover); color: var(--text); }
.refresh:disabled { opacity: .45; cursor: default; }
.body { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.search { position: relative; flex-shrink: 0; margin: 0 10px 8px; }
.categories { display: flex; flex-shrink: 0; flex-direction: column; gap: 2px; padding: 0 8px; }
.category { display: flex; align-items: center; gap: 10px; min-height: 36px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); font-size: 14px; text-align: left; cursor: pointer; }
.category:hover, .item:hover { background: var(--bg-hover); }
.category[aria-pressed="true"], .item[aria-pressed="true"] { background: var(--bg-selected); }
.installedHeading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; margin: 24px 12px 4px 18px; }
.installedHeading h2 { margin: 0; color: var(--text-muted); font-size: 13px; font-weight: 500; }
.list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.items { margin: 0; padding: 0; list-style: none; }
.item { display: flex; align-items: center; width: 100%; gap: 10px; padding: 8px 10px; border: 0; border-radius: var(--radius-control); background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.item:focus-visible, .refresh:focus-visible, .toggle:focus-visible, .source:focus-visible, .category:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.metadata { display: block; margin-top: 2px; color: var(--text-dim); font-size: 10px; }
.empty { padding: 18px 8px; color: var(--text-muted); font-size: 12px; }
.count { margin-left: 6px; color: var(--text-dim); font-size: 11px; }

@media (max-width: 959px) {
  .workspace { flex-direction: column; }
  .sidebar { flex: 0 0 auto; width: 100%; border-right: 0; border-bottom: 1px solid var(--border); }
  .header { min-height: 48px; padding: 6px 12px; }
  .source { flex: 0 1 auto; margin-right: auto; font-size: 15px; }
  .toggle { display: inline-flex; }
  .body { display: none; max-height: min(48vh, 420px); }
  .sidebar[data-expanded="true"] .body { display: flex; }
  .installedHeading { margin-top: 12px; }
}
''')

# Optional view keeps the existing standalone management dialogs compatible.
for p in ['components/SkillsConfig.tsx','components/PluginsConfig.tsx']:
 s=read(p); start=s.index('export function '); before=s[:start]; body=s[start:]
 body=body.replace('  onInstalledChange,','  onInstalledChange,\n  view,',1)
 body=body.replace('  embedded?: boolean;','  embedded?: boolean;\n  view?: "installed" | "market";',1)
 body=body.replace('{addMode ? (','{(view ? view === "market" : addMode) ? (',1)
 # Hide the duplicate internal list; the shared sidebar owns selection in the center.
 marker='width: isMobile ? "100%" : 210,'
 idx=body.index(marker); end=body.index('display: "flex",',idx)
 body=body[:end]+body[end:].replace('display: "flex",','display: view ? "none" : "flex",',1)
 if 'Skills' in p:
  body=body.replace('const list = d.skills ?? [];','const list = (d.skills ?? []).filter(skill => !view || (!skill.organizationCapability && !skill.managedPlugin));',1)
  body=body.replace('}, [cwd, selected]);','}, [cwd, selected, view]);',1)
  # Selection updates must refresh data after mutations performed in the other view.
  marker='  const checkForUpdates ='
  idx=body.index(marker)
  body=body[:idx]+'''  useEffect(() => {
    if (selection) void loadSkills();
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

'''+body[idx:]
  body=body.replace('const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;', 'const selectedSkill = skills.find((s) => s.filePath === selected) ?? (view === "installed" ? skills[0] : null) ?? null;')
 else:
  body=body.replace('const packages = useMemo(() => data?.packages ?? [], [data?.packages]);','const packages = useMemo(() => (data?.packages ?? []).filter(pkg => !view || pkg.status !== "missing"), [data?.packages, view]);')
  body=body.replace('const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;', 'const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? (view === "installed" ? packages[0] : null) ?? null;')
  body=body.replace('  }, [loadPlugins]);','  }, [loadPlugins, selection]);',1)
 # Keep refresh/actions in headers; remove duplicated label and path only when viewed in the center.
 if 'Skills' in p:
  marker='        {/* Header */}'
  hstart=body.index(marker); hend=body.index('        {!projectResourcesLoaded',hstart)
  header=body[hstart:hend]; header=header.replace('        <div\n','        {!view && <div\n',1)
  close=header.rfind('</div>'); header=header[:close]+header[close:].replace('</div>','</div>}',1)
  body=body[:hstart]+header+body[hend:]
 write(p,before+body)

p='components/McpConfig.tsx';s=read(p)
s=s.replace('selection, onInstalledChange }:','selection, onInstalledChange, view }:')
s=s.replace('onInstalledChange?: () => void })','onInstalledChange?: () => void; view?: "installed" | "market" })')
s=s.replace('const [isNew, setIsNew] = useState(true);','const [isNew, setIsNew] = useState(view !== "installed");')
s=s.replace('}, [load]);','}, [load, selection]);',1)
s=s.replace('display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)"','display: view ? "none" : "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)"',1)
s=s.replace('<div style={{ maxWidth: 660 }}>','<div style={{ maxWidth: 660 }}>\n        {view === "installed" && !configuredActive ? <p className="text-sm text-[var(--text-muted)]">{error ?? t("extensions.noInstalledCapabilities")}</p> : <>',1)
s=s.replace('      </div></main>','      </>}</div></main>',1)
s=s.replace('setScope(next); add();','setScope(next); if (view === "installed") { setSelected(null); setIsNew(false); } else add();')
write(p,s)

for locale,values in [('zh-CN',{'source':'扩展来源','category':'能力类型','toggleNavigation':'展开扩展导航','browseMarket':'市场'}),('en',{'source':'Extension source','category':'Capability type','toggleNavigation':'Toggle extension navigation','browseMarket':'Marketplace'})]:
 p=f'lib/i18n/messages/{locale}.ts';s=read(p)
 marker='    "extensions.installedCapabilities":'
 idx=s.index(marker)
 s=s[:idx]+''.join(f'    "extensions.{key}": "{value}",\n' for key,value in values.items())+s[idx:]
 write(p,s)

p='components/ExtensionsCenter.tsx';s=read(p)
s=s.replace('type MarketSection = "skills" | "plugins" | "mcp";','type ExtensionView = "installed" | "market";')
s=s.replace('function OrganizationExtensionsPage({ kind, cwd, sessionId, cached,','function OrganizationExtensionsPage({ kind, cwd, sessionId, view, installedRevision, cached,',1)
s=s.replace('{ kind: OrganizationSection; cwd: string; sessionId?: string | null; cached?:','{ kind: OrganizationSection; cwd: string; sessionId?: string | null; view: ExtensionView; installedRevision: number; cached?:',1)
s=s.replace('const [showInstalled, setShowInstalled] = useState(false);','const showInstalled = view === "installed";')
s=s.replace('kind, showInstalled, sessionId]);','kind, showInstalled, sessionId, installedRevision]);',1)
# The locally installed list still works when the remote catalog is unavailable.
s=s.replace('if (state !== "ready" && state !== "empty") return','if (!showInstalled && state !== "ready" && state !== "empty") return',1)
start=s.index('<label className="inline-flex h-8 shrink-0 cursor-pointer')
end=s.index('{showInstalled && <Tabs',start)
s=s[:start]+s[end:]
s=s.replace('const [marketSection, setMarketSection] = useState<MarketSection>("skills");','''const [marketSection, setMarketSection] = useState<OrganizationSection>("skills");
  const [view, setView] = useState<ExtensionView>("market");
  const section = activeGroup === "organization" ? organizationSection : marketSection;
  const pageKey = `${activeGroup}:${section}:${view}`;
  // Keep visited content mounted so searches, configuration drafts and scroll positions survive navigation.
  const [visited, setVisited] = useState<string[]>([pageKey]);
  useEffect(() => { setVisited(current => current.includes(pageKey) ? current : [...current, pageKey]); }, [pageKey]);''')
s=s.replace('  const setOrganizationDetails = setOrganizationCategories;\n','')
s=s.replace('    setSelectedInstalledKey(item.key);','    setSelectedInstalledKey(item.key);\n    setView("installed");')
start=s.index('  return <main className={installedStyles.workspace}>')
s=s[:start]+'''  const cancelSelection = () => {
    selectionControllerRef.current?.abort();
    selectionRequestRef.current += 1;
    setSelectedInstalledKey(undefined);
  };
  const changeSource = (source: ExtensionGroup) => {
    if (guest && source === "organization") return;
    cancelSelection(); setGroup(source);
  };
  const changeSection = (next: OrganizationSection) => {
    cancelSelection();
    if (activeGroup === "organization") setOrganizationSection(next); else setMarketSection(next);
  };
  const title = t(section === "skills" ? "extensions.skills" : section === "plugins" ? "extensions.plugins" : "extensions.mcp");
  return <main className={installedStyles.workspace}>
    <InstalledCapabilitiesSidebar cwd={cwd} sessionId={sessionId} active={active} revision={installedRevision + installedRefresh} selectedKey={view === "installed" ? selectedInstalledKey : undefined} onSelect={item => { void openInstalled(item); }} source={activeGroup} section={section} guest={guest} onSourceChange={changeSource} onSectionChange={changeSection} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        {onShowSidebar ? <Tooltip><TooltipTrigger render={<button type="button" onClick={onShowSidebar} aria-label={t("sidebar.show")} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg></button>} /><TooltipContent>{t("sidebar.show")}</TooltipContent></Tooltip> : null}
        <h1 className="mr-auto flex items-center gap-2 text-base font-semibold"><ExtensionIcon kind={section} />{title}</h1>
        <Tabs value={view} onValueChange={value => { cancelSelection(); setView(value as ExtensionView); }}>
          <TabsList aria-label={title}><TabsTrigger value="installed">{t("extensions.installed")}</TabsTrigger><TabsTrigger value="market">{t("extensions.browseMarket")}</TabsTrigger></TabsList>
        </Tabs>
      </header>
      {visited.map(key => {
        const [source, kind, contentView] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView];
        if (source === "organization" && guest) return null;
        return <div key={key} role="tabpanel" aria-label={`${t(source === "organization" ? "extensions.organization" : "extensions.market")} · ${t(kind === "skills" ? "extensions.skills" : kind === "plugins" ? "extensions.plugins" : "extensions.mcp")} · ${t(contentView === "installed" ? "extensions.installed" : "extensions.browseMarket")}`} hidden={key !== pageKey} className="min-h-0 flex-1 overflow-hidden" style={{ display: key === pageKey ? "block" : "none" }}>
          {source === "organization" ? <OrganizationExtensionsPage kind={kind} view={contentView} installedRevision={installedRevision + installedRefresh} cwd={cwd} sessionId={sessionId} cached={organizationCache[kind]} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationCategories} onOpenDetails={openExtensionDetails} onInstalledChange={refreshInstalled} />
            : kind === "skills" ? <SkillsConfig cwd={cwd} embedded view={contentView} selection={contentView === "installed" ? skillSelection : undefined} onInstalledChange={refreshInstalled} onClose={() => undefined} />
            : kind === "plugins" ? <PluginsConfig cwd={cwd} sessionId={sessionId} embedded view={contentView} selection={contentView === "installed" ? pluginSelection : undefined} onInstalledChange={refreshInstalled} onClose={() => undefined} onReloaded={onReloaded} />
            : <McpConfig cwd={cwd} sessionId={sessionId} view={contentView} selection={contentView === "installed" ? mcpSelection : undefined} onInstalledChange={refreshInstalled} onReloaded={onReloaded} />}
        </div>;
      })}
    </div>
  </main>;
}
'''
write(p,s)
