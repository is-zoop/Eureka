from pathlib import Path

for name in ['ExtensionsCenter','OrganizationExtensionDetails']:
 p=Path('components')/(name+'.tsx');s=p.read_text(encoding='utf-8');marker='import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";'
 s=s.replace(marker,marker+'\nimport { capabilityTypeLabelKey } from "@/lib/organization-capability";',1)
 s=s.replace('>{item.type}</span>', '>{t(capabilityTypeLabelKey(item.type))}</span>')
 if name=='ExtensionsCenter':
  s=s.replace('t(item.type === "Skill" ? "extensions.skills" : item.type === "Plugin" ? "extensions.plugins" : "extensions.mcp")', 't(capabilityTypeLabelKey(item.type))')
  s=s.replace('`${item.name}的 MCP 配置已保存。重载会话后生效。`', 't("extensions.connectorSaved", { name: item.name })')
 p.write_text(s,encoding='utf-8')

for name in ['OrganizationPluginSummary','OrganizationPluginDialog']:
 p=Path('components')/(name+'.tsx');s=p.read_text(encoding='utf-8').replace('>Skill · {skill}', '>{t("extensions.skills")} · {skill}').replace('>MCP · {server.name}', '>{t("extensions.mcp")} · {server.name}');p.write_text(s,encoding='utf-8')

p=Path('components/McpConfig.tsx');s=p.read_text(encoding='utf-8')
start=s.index('const lifecycleNote:');end=s.index('\n\nconst controlStyle',start);s=s[:start]+s[end:]
s=s.replace('  const { t } = useI18n();','''  const { t } = useI18n();
  const lifecycleNote = { lazy: t("extensions.lifecycle.lazy"), eager: t("extensions.lifecycle.eager"), "keep-alive": t("extensions.lifecycle.keepAlive") };''',1)
s=s.replace('payload.error ?? "加载 MCP 配置失败"','payload.error ?? t("extensions.connectorLoadFailed")').replace('}, [cwd, scope]);','}, [cwd, scope, t]);',1)
s=s.replace('setNotice(disabled ? "已禁用。重载当前会话后停止加载该 Server。" : "已启用。重载当前会话后生效。");','setNotice(t(disabled ? "extensions.connectorDisabledHint" : "extensions.connectorEnabledHint"));')
s=s.replace('>MCP</span>', '>{t("extensions.mcp")}</span>')
s=s.replace('>未找到 MCP Server</p>', '>{t("extensions.connectorEmpty")}</p>')
s=s.replace('>HAZE 受管 MCP</p>', '>{t("extensions.connectorManaged")}</p>')
s=s.replace(' /> 添加 MCP Server</button>', ' /> {t("extensions.connectorAdd")}</button>')
s=s.replace('isNew ? "添加 MCP Server" : `编辑 ${selected}`', 'isNew ? t("extensions.connectorAdd") : t("extensions.connectorEdit", { name: selected ?? "" })')
s=s.replace('form.disabled ? "启用 MCP Server" : "禁用 MCP Server"', 't(form.disabled ? "extensions.connectorEnable" : "extensions.connectorDisable")')
p.write_text(s,encoding='utf-8')

# Embedded package statistics are user-facing labels too.
p=Path('components/PluginsConfig.tsx');s=p.read_text(encoding='utf-8').replace('{`${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes`}', '{[[data.totals.extensions, t("i18n.extensionShort")], [data.totals.skills, t("extensions.skills")], [data.totals.prompts, t("i18n.promptShort")], [data.totals.themes, t("i18n.themeShort")]].map(([count, label]) => t("i18n.resourceCount", { count, label })).join(" · ")}');p.write_text(s,encoding='utf-8')
p=Path('components/SkillsConfig.tsx');s=p.read_text(encoding='utf-8').replace('Search skills.sh to discover and install skills for your agent.', '{t("extensions.skillSearchHint")}');p.write_text(s,encoding='utf-8')

values={
 'zh-CN':{
  'connectorAdd':'添加连接器','connectorEdit':'编辑 {name}','connectorEmpty':'未找到连接器','connectorManaged':'HAZE 受管连接器',
  'connectorEnable':'启用连接器','connectorDisable':'禁用连接器','connectorLoadFailed':'连接器配置加载失败',
  'connectorSaved':'{name}的连接器配置已保存。重载会话后生效。',
  'connectorDisabledHint':'已禁用。重载当前会话后停止加载该连接器。','connectorEnabledHint':'已启用。重载当前会话后生效。',
  'skillSearchHint':'搜索 skills.sh，发现并安装可用技能。',
 },
 'en':{
  'connectorAdd':'Add MCP server','connectorEdit':'Edit {name}','connectorEmpty':'No MCP servers found','connectorManaged':'HAZE-managed MCP servers',
  'connectorEnable':'Enable MCP server','connectorDisable':'Disable MCP server','connectorLoadFailed':'Failed to load MCP configuration',
  'connectorSaved':'MCP configuration saved for {name}. Reload the session to apply it.',
  'connectorDisabledHint':'Disabled. Reload the current session to stop loading this MCP server.','connectorEnabledHint':'Enabled. Reload the current session to apply it.',
  'skillSearchHint':'Search skills.sh to discover and install skills for your agent.',
 },
}
for locale,entries in values.items():
 p=Path('lib/i18n/messages')/(locale+'.ts');s=p.read_text(encoding='utf-8');idx=s.index('    "extensions.mcp":');s=s[:idx]+''.join(f'    "extensions.{key}": "{value}",\n' for key,value in entries.items())+s[idx:]
 if locale=='zh-CN':
  s=s.replace('"extensions.description": "管理技能与插件"','"extensions.description": "管理技能、连接器与插件"')
  s=s.replace('"extensions.mcp": "MCP"','"extensions.mcp": "连接器"')
  s=s.replace('"extensions.organizationMcp": "MCP 工具"','"extensions.organizationMcp": "组织连接器"')
  s=s.replace('"此 MCP 属于组织插件，请在组织插件中统一管理。"','"此连接器属于组织插件，请在组织插件中统一管理。"')
  s=s.replace('"为组织接入和管理 MCP 工具"','"为组织接入和管理连接器"')
  s=s.replace('"暂未配置 MCP 工具。后续可在此集中查看与管理组织接入的工具。"','"暂未配置连接器。后续可在此集中查看与管理组织接入的连接器。"')
  s=s.replace('"仅在首次调用该 Server 工具时连接，节省资源。"','"仅在首次调用该连接器的工具时连接，节省资源。"')
 p.write_text(s,encoding='utf-8')
