from pathlib import Path
p=Path('components/ExtensionsCenter.tsx');s=p.read_text(encoding='utf-8')
marker='type ExtensionView = "installed" | "market";'
s=s.replace(marker,marker+'''
type InstalledSelection = {
  item: InstalledSidebarCapability;
  skill?: { filePath: string; requestId: number };
  plugin?: { source: string; scope: InstallScope; requestId: number };
  mcp?: { name: string; scope: InstallScope; requestId: number };
};''')
s=s.replace('  const section = activeGroup', '  const [installedScope, setInstalledScope] = useState<InstallScope>("global");\n  const section = activeGroup',1)
s=s.replace('const pageKey = `${activeGroup}:${section}:${view}`;', 'const pageKey = `${activeGroup}:${section}:${view}${view === "installed" ? `:${installedScope}` : ""}`;')
start=s.index('  const [selectedInstalledItems,');end=s.index('  const openInstalled =',start)
s=s[:start]+'''  const [installedSelections, setInstalledSelections] = useState<Record<string, InstalledSelection>>({});
  const selectedInstalledItem = installedSelections[`${activeGroup}:${section}:${installedScope}`]?.item;
  const selectionRequestRef = useRef(0);
'''+s[end:]
s=s.replace('    setSelectedInstalledItems(current => ({ ...current, [`${source}:${section}`]: item }));\n    setView("installed"); setGroup(source);', '''    const selection: InstalledSelection = { item };
    if (target.type === "skill") selection.skill = { filePath: target.filePath, requestId };
    else if (target.type === "plugin") selection.plugin = { source: target.source, scope: target.scope, requestId };
    else if (target.type === "mcp") selection.mcp = { name: target.name, scope: target.scope, requestId };
    setInstalledSelections(current => ({ ...current, [`${source}:${section}:${item.scope}`]: selection }));
    setView("installed"); setGroup(source);''')
start=s.index('    else {\n      setMarketSection(section);',s.index('  const openInstalled ='))
end=s.index('  const changeSource =',start)
s=s[:start]+'''    else setMarketSection(section);
  };
  const changeScope = (scope: InstallScope) => {
    onCloseExtensionDetails?.(); setInstalledScope(scope);
  };
'''+s[end:]
s=s.replace('cwd={cwd} sessionId={sessionId} active={active} revision=', 'cwd={cwd} sessionId={sessionId} active={active} scope={installedScope} onScopeChange={changeScope} revision=',1)
s=s.replace('const [source, kind, contentView] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView];\n        const selection = selectedInstalledItems[`${source}:${kind}`];', '''const [source, kind, contentView, scope] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView, InstallScope?];
        const selection = contentView === "installed" ? installedSelections[`${source}:${kind}:${scope}`] : undefined;''')
s=s.replace('{source === "organization" ? <OrganizationExtensionsPage', '{contentView === "installed" && !selection ? <div className="grid h-full place-items-center p-6 text-sm text-[var(--text-muted)]">{t("extensions.selectInstalled")}</div> : source === "organization" ? <OrganizationExtensionsPage')
s=s.replace('selection?.target.type === "organization" ? selection.target.install : undefined', 'selection?.item.target.type === "organization" ? selection.item.target.install : undefined')
s=s.replace('selection={contentView === "installed" ? skillSelection : undefined}', 'selection={selection?.skill}')
s=s.replace('selection={contentView === "installed" ? pluginSelection : undefined}', 'selection={selection?.plugin}')
s=s.replace('selection={contentView === "installed" ? mcpSelection : undefined}', 'selection={selection?.mcp}')
p.write_text(s,encoding='utf-8')
for locale,value in [('en','Select an installed capability to manage it.'),('zh-CN','请选择已安装的能力进行管理。')]:
 p=Path('lib/i18n/messages')/(locale+'.ts');s=p.read_text(encoding='utf-8').replace('    "extensions.installedCapabilities":', f'    "extensions.selectInstalled": "{value}",\n    "extensions.installedCapabilities":',1);p.write_text(s,encoding='utf-8')
