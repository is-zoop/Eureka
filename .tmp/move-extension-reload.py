from pathlib import Path
p=Path('components/ExtensionsCenter.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('  const [reloadBusy, setReloadBusy] = useState(false);\n','',1)
start=s.index('{sessionId ? <Button variant="outline" size="sm" disabled={reloadBusy}')
end=s.index('<ViewToggle viewMode={viewMode}',start)
s=s[:start]+s[end:]
marker='  const [installedRefresh, setInstalledRefresh] = useState(0);'
s=s.replace(marker,marker+'''
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const reloadSession = async () => {
    if (!sessionId || reloadBusy) return;
    setReloadBusy(true);
    try {
      const response = await fetch(`/api/agent/${sessionId}`);
      const state = await response.json();
      if (!response.ok || state.state?.isStreaming) throw new Error(t("extensions.pluginReloadWhenIdle"));
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadRevision(value => value + 1);
      notify({ type: "success", title: t("extensions.reload"), message: t("extensions.pluginReloaded") });
    } catch (error) {
      notify({ type: "error", title: t("extensions.reload"), message: error instanceof Error ? error.message : t("extensions.pluginPrepareFailed") });
    } finally { setReloadBusy(false); }
  };''',1)
marker='        <h1 className="mr-auto flex items-center gap-2 text-base font-semibold"><ExtensionIcon kind={section} />{title}</h1>'
s=s.replace(marker,marker+'''
        {activeGroup === "organization" && sessionId ? <Button variant="outline" size="sm" className="shrink-0 gap-1.5" disabled={reloadBusy} aria-busy={reloadBusy} onClick={() => void reloadSession()}><RefreshCwIcon size={14} aria-hidden="true" className={reloadBusy ? "animate-spin" : undefined} />{t("extensions.reload")}</Button> : null}''',1)
s=s.replace('<OrganizationExtensionsPage kind={kind} view={contentView} selection={selection?.item.target.type === "organization" ? selection.item.target.install : undefined} installedRevision={installedRevision + installedRefresh}', '<OrganizationExtensionsPage kind={kind} view={contentView} selection={selection?.item.target.type === "organization" ? selection.item.target.install : undefined} installedRevision={installedRevision + installedRefresh + reloadRevision}',1)
p.write_text(s,encoding='utf-8')
