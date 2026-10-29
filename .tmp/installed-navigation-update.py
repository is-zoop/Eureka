from pathlib import Path

p=Path('components/ExtensionsCenter.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace('type InstalledCapability as InstalledSidebarCapability }', 'type InstalledCapability as InstalledSidebarCapability }') # Existing alias import is kept below.
s=s.replace('import type { InstalledCapability as InstalledSidebarCapability }', 'import type { ManagedCapabilityInstall, InstalledCapability as InstalledSidebarCapability }')
s=s.replace('onShowSidebar?: () => void; onOpenExtensionDetails:', 'onShowSidebar?: () => void; onCloseExtensionDetails?: () => void; onOpenExtensionDetails:')
s=s.replace('sessionId, view, installedRevision, cached,', 'sessionId, view, selection, installedRevision, cached,',1)
s=s.replace('view: ExtensionView; installedRevision: number; cached?:', 'view: ExtensionView; selection?: ManagedCapabilityInstall; installedRevision: number; cached?:',1)
s=s.replace('const [installedScope, setInstalledScope] = useState<InstallScope>("global");', 'const installedScope: InstallScope = selection?.scope ?? "global";')
s=s.replace('return installed.map((install) => {', 'return installed.filter(install => !selection || (install.capabilityId === selection.capabilityId && install.scope === selection.scope)).map((install) => {',1)
s=s.replace('}, [installed, items]);', '}, [installed, items, selection]);',1)
start=s.index('{showInstalled && <Tabs value={installedScope}')
end=s.index('<div className="flex items-center gap-2 sm:ml-auto">',start)
s=s[:start]+s[end:]
# A selected installed item is a management view, so catalog filters should not hide it.
start=s.index('<FilterMenu filter={filter} categories={availableCategories}')
end=s.index('<div className="flex items-center gap-2 sm:ml-auto">',start)
s=s[:start]+'{!showInstalled && <>'+s[start:end]+'</>}'+s[end:]
s=s.replace('onReloaded, onShowSidebar, onOpenExtensionDetails }: Props)', 'onReloaded, onShowSidebar, onCloseExtensionDetails, onOpenExtensionDetails }: Props)')
s=s.replace('const [selectedInstalledKeys, setSelectedInstalledKeys] = useState<Record<string, string>>({});', 'const [selectedInstalledItems, setSelectedInstalledItems] = useState<Record<string, InstalledSidebarCapability>>({});\n  const selectedInstalledItem = selectedInstalledItems[`${activeGroup}:${section}`];')
start=s.index('  const selectionRequestRef = useRef(0);',s.index('export function ExtensionsCenter'))
end=s.index('  const changeSource =', start)
s=s[:start]+'''  const openInstalled = (item: InstalledSidebarCapability) => {
    const target = item.target;
    if (target.type === "organization" && guest) {
      notify({ type: "warning", message: t("extensions.loginRequired") });
      return;
    }
    onCloseExtensionDetails?.();
    const requestId = ++selectionRequestRef.current;
    const section = item.kind === "Skill" ? "skills" : item.kind === "Plugin" ? "plugins" : "mcp";
    const source = target.type === "organization" ? "organization" : "market";
    setSelectedInstalledItems(current => ({ ...current, [`${source}:${section}`]: item }));
    setView("installed"); setGroup(source);
    if (target.type === "organization") setOrganizationSection(section);
    else {
      setMarketSection(section);
      if (target.type === "skill") setSkillSelection({ filePath: target.filePath, requestId });
      else if (target.type === "plugin") setPluginSelection({ source: target.source, scope: target.scope, requestId });
      else setMcpSelection({ name: target.name, scope: target.scope, requestId });
    }
  };
  const selectionRequestRef = useRef(0);
''' +s[end:]
s=s.replace('    cancelSelection(); setGroup(source);', '    onCloseExtensionDetails?.(); setView("market"); setGroup(source);')
s=s.replace('    cancelSelection();\n    if (activeGroup', '    onCloseExtensionDetails?.(); setView("market");\n    if (activeGroup')
s=s.replace('const title = t(section === "skills" ? "extensions.skills" : section === "plugins" ? "extensions.plugins" : "extensions.mcp");', 'const title = view === "installed" && selectedInstalledItem ? selectedInstalledItem.name : t(section === "skills" ? "extensions.skills" : section === "plugins" ? "extensions.plugins" : "extensions.mcp");')
s=s.replace('selectedKey={view === "installed" ? selectedInstalledKeys[`${activeGroup}:${section}`] : undefined}', 'selectedKey={view === "installed" ? selectedInstalledItem?.key : undefined} browsing={view === "market"}')
s=s.replace('onSelect={item => { void openInstalled(item); }}', 'onSelect={openInstalled}')
start=s.index('        <Tabs value={view}',s.index('export function ExtensionsCenter'))
end=s.index('      </header>',start)
s=s[:start]+s[end:]
s=s.replace('role="tabpanel" aria-label=', 'role="region" aria-label=')
s=s.replace('const [source, kind, contentView] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView];', '''const [source, kind, contentView] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView];
        const selection = selectedInstalledItems[`${source}:${kind}`];''')
s=s.replace('<OrganizationExtensionsPage kind={kind} view={contentView} installedRevision=', '<OrganizationExtensionsPage kind={kind} view={contentView} selection={selection?.target.type === "organization" ? selection.target.install : undefined} installedRevision=')
p.write_text(s,encoding='utf-8')

p=Path('components/InstalledCapabilitiesSidebar.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('onSectionChange }: {', 'onSectionChange, browsing = true }: {')
s=s.replace('source: ExtensionSource; section: ExtensionSection; guest?: boolean;', 'source: ExtensionSource; section: ExtensionSection; guest?: boolean; browsing?: boolean;')
s=s.replace('aria-pressed={section === value}', 'aria-pressed={browsing && section === value}')
start=s.index('<span className={styles.metadata}>')
end=s.index('</span>',start)+len('</span>')
s=s[:start]+s[end:]
p.write_text(s,encoding='utf-8')
p=Path('components/InstalledCapabilitiesSidebar.module.css');s=p.read_text(encoding='utf-8')
s='\n'.join(line for line in s.split('\n') if not line.startswith('.metadata '))
p.write_text(s,encoding='utf-8')

p=Path('components/AppShell.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('onOpenExtensionDetails={handleOpenExtensionDetails}', 'onOpenExtensionDetails={handleOpenExtensionDetails}\n                onCloseExtensionDetails={() => setExtensionPanelOpen(false)}',1)
p.write_text(s,encoding='utf-8')
