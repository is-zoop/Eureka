"use client";

import type { ReactNode } from "react";
import { ArrowUpRightIcon, FileTextIcon, LayersIcon, PackageIcon, PlugIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { PluginPackageInfo, SkillInfo, SkillUpdateResult } from "@/lib/api-types";
import { CapabilityTypeBadge } from "./CapabilityTypeBadge";
import { CapabilityInstallRuntime } from "./CapabilityInstallRuntime";
import { ExtensionErrorText } from "./ExtensionNotice";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

type PluginAction = "update" | "remove" | "enable" | "disable";

function ManagementHeader({ name, kind, enabled, busy, onToggle }: {
  name: string; kind: "Plugin" | "Skill"; enabled: boolean; busy: boolean; onToggle: () => void;
}) {
  const { t } = useI18n();
  const Icon = kind === "Plugin" ? PlugIcon : LayersIcon;
  const label = kind === "Skill" ? t("extensions.marketAutoInvocation") : t(enabled ? "extensions.managementEnabled" : "extensions.pluginState.disabled");
  return <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="flex min-w-0 flex-1 items-start gap-4"><span className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-hover)]"><Icon size={26} aria-hidden="true" /></span><div className="min-w-0 flex-1"><h2 className="break-words text-[21px] font-semibold leading-snug">{name}</h2><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]"><CapabilityTypeBadge type={kind} className="rounded-[var(--radius-control)] px-2 py-1" /></div></div></div>
    <label className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-3 py-1 text-[13px]"><span>{label}</span><Switch checked={enabled} disabled={busy} onCheckedChange={onToggle} aria-label={kind === "Skill" ? label : `${t(enabled ? "extensions.disable" : "extensions.enable")}${name}`} /></label>
  </div>;
}

function InstallationDetails({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <details data-market-install-details className="mt-6 border-t border-[var(--border)] pt-4 text-[12px] text-[var(--text-muted)]"><summary className="w-fit cursor-pointer rounded text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t("extensions.marketInstallDetails")}</summary><dl className="mt-4 grid grid-cols-[minmax(70px,auto)_minmax(0,1fr)] items-start gap-x-5 gap-y-3">{children}</dl></details>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="break-words">{label}</dt><dd className="min-w-0 break-all font-mono">{children}</dd></>;
}

function ContentPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section data-market-management-panel className="mt-6 min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)]"><h3 className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-[13px] font-semibold">{icon}{title}</h3><div className="max-h-[360px] min-w-0 overflow-y-auto overscroll-contain p-4">{children}</div></section>;
}

export function MarketPluginManagement({ pkg, cwd, busy, action, onAction }: {
  pkg: PluginPackageInfo; cwd: string; busy: boolean; action: string | null;
  onAction: (action: PluginAction) => void;
}) {
  const { t } = useI18n();
  const name = pkg.packageName || pkg.source;
  const groups = (["extension", "skill", "prompt", "theme"] as const).map(kind => ({ kind, resources: pkg.resources.filter(resource => resource.kind === kind) })).filter(group => group.resources.length);
  const groupLabel = { extension: "i18n.extensions", skill: "extensions.skills", prompt: "i18n.prompts", theme: "i18n.themes" };
  return <article data-market-plugin-management className="w-full min-w-0 text-[var(--text)]">
    <ManagementHeader name={name} kind="Plugin" enabled={!pkg.disabled} busy={busy} onToggle={() => onAction(pkg.disabled ? "enable" : "disable")} />
    <p className="mt-5 break-all font-mono text-[13px] text-[var(--text-muted)]">{pkg.source}</p>
    <div className="mt-5 border-t border-[var(--border)] pt-4"><CapabilityInstallRuntime scope={pkg.scope} state={pkg.disabled ? "disabled" : pkg.status} version={pkg.version ?? ""} actions={<>
      <Button type="button" variant="outline" size="sm" className="h-[30px] gap-1.5" disabled={busy} onClick={() => onAction("update")}><RefreshCwIcon size={14} aria-hidden="true" className={action === "update" ? "animate-spin" : undefined} />{t(action === "update" ? "i18n.updating" : "i18n.update")}</Button>
      <Button type="button" variant="destructive" size="sm" className="h-[30px] gap-1.5" disabled={busy} onClick={() => onAction("remove")}><Trash2Icon size={14} aria-hidden="true" />{t(action === "remove" ? "i18n.removing" : "extensions.uninstall")}</Button>
    </>} /></div>
    <ContentPanel icon={<PackageIcon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />} title={t("extensions.marketIncludedResources")}>
      {groups.length ? <div className="space-y-5">{groups.map(group => <div key={group.kind}><h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">{t(groupLabel[group.kind])} · {group.resources.length}</h4><ul className="divide-y divide-[var(--border)]">{group.resources.map(resource => <li key={resource.path} className="py-2 first:pt-0"><p className="break-all text-[13px] font-medium">{resource.name}</p><p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{resource.relativePath}</p></li>)}</ul></div>)}</div> : <div className="flex min-h-[150px] flex-col items-center justify-center gap-3 text-center"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-hover)] text-[var(--text-muted)]"><PackageIcon size={18} aria-hidden="true" /></span><p className="text-[13px] font-medium">{t(pkg.disabled ? "i18n.packageDisabled" : "extensions.marketNoResources")}</p><p className="max-w-md text-xs leading-5 text-[var(--text-muted)]">{t(pkg.disabled ? "extensions.marketDisabledResourcesHint" : "extensions.marketNoResourcesHint")}</p></div>}
    </ContentPanel>
    <InstallationDetails><Detail label={t("extensions.marketSource")}>{pkg.source}</Detail><Detail label={t("extensions.installScope")}>{t(pkg.scope === "global" ? "extensions.global" : "extensions.project")}</Detail>{pkg.configuredVersion ? <Detail label={t("extensions.marketConfiguredVersion")}>{pkg.configuredVersion}</Detail> : null}<Detail label={t("i18n.installedPath")}>{pkg.installedPath || t("i18n.notFound")}</Detail><Detail label={t("extensions.marketCurrentProject")}>{cwd}</Detail>{pkg.filtered ? <Detail label={t("extensions.marketResourceFilter")}>{t("i18n.filtered")}</Detail> : null}</InstallationDetails>
  </article>;
}

export function MarketSkillManagement({ skill, cwd, busy, checking, updating, uninstalling = false, update, onToggle, onCheck, onUpdate, onUninstall }: {
  skill: SkillInfo; cwd: string; busy: boolean; checking: boolean; updating: boolean; uninstalling?: boolean; update?: SkillUpdateResult;
  onToggle: () => void; onCheck: () => void; onUpdate: () => void; onUninstall?: () => void;
}) {
  const { t } = useI18n();
  const sourceScope = skill.install?.scope ?? skill.sourceInfo.scope ?? skill.sourceInfo.source;
  const scope = sourceScope === "project" ? "project" : sourceScope === "user" || sourceScope === "global" ? "global" : "path";
  const canCheck = Boolean(skill.install?.canCheckForUpdates);
  const canUninstall = Boolean(onUninstall && skill.install && !skill.managedPlugin && !skill.organizationCapability);
  const version = update?.currentVersion ?? skill.install?.versionHash ?? "";
  const latest = update?.state === "update-available" ? update.latestVersion : undefined;
  const sourceUrl = skill.install?.skillsShUrl;
  const safeUrl = sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined;
  return <article data-market-skill-management className="w-full min-w-0 text-[var(--text)]">
    <ManagementHeader name={skill.name} kind="Skill" enabled={!skill.disableModelInvocation} busy={busy} onToggle={onToggle} />
    {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex max-w-full items-start gap-1.5 rounded text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><span className="min-w-0 break-all">{skill.install?.source || safeUrl.replace(/^https?:\/\//i, "")}</span><ArrowUpRightIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" /></a> : null}
    {skill.disableModelInvocation ? <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{t("i18n.hiddenButInvocable")}</p> : null}
    <div className="mt-5 border-t border-[var(--border)] pt-4"><CapabilityInstallRuntime scope={scope} state="installed" version={version} latestVersion={latest} versionFormat="hash" versionStatus={update?.state === "up-to-date" ? t("i18n.upToDate") : undefined} actions={canCheck || canUninstall ? <>
      {canCheck ? <Button type="button" variant="outline" size="sm" className="h-[30px] gap-1.5" disabled={busy} onClick={onCheck}><RefreshCwIcon size={14} aria-hidden="true" className={checking ? "animate-spin" : undefined} />{t(checking ? "i18n.checking" : "i18n.checkUpdates")}</Button> : null}
      {update?.state === "update-available" ? <Button type="button" size="sm" className="h-[30px] gap-1.5 bg-blue-500 text-white hover:bg-blue-600" disabled={busy} onClick={onUpdate}><RefreshCwIcon size={14} aria-hidden="true" className={updating ? "animate-spin" : undefined} />{t(updating ? "i18n.updating" : "i18n.update")}</Button> : null}
      {canUninstall ? <Button type="button" variant="destructive" size="sm" className="h-[30px] gap-1.5" disabled={busy} onClick={onUninstall}><Trash2Icon size={14} aria-hidden="true" />{t(uninstalling ? "extensions.marketUninstalling" : "extensions.uninstall")}</Button> : null}
    </> : undefined} />{update && update.state !== "update-available" && update.state !== "up-to-date" ? <div role="status" className="mt-3 text-xs text-[var(--text-muted)]">{update.state === "unsupported" ? t("i18n.automaticChecksUnavailable") : <ExtensionErrorText error={update.message || t("i18n.checkFailed")} />}</div> : null}</div>
    <ContentPanel icon={<FileTextIcon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />} title={t("extensions.marketSkillDescription")}><p className="whitespace-pre-wrap break-words text-[13px] leading-7 text-[var(--text-muted)]">{skill.description || t("extensions.marketNoDescription")}</p></ContentPanel>
    <InstallationDetails>{skill.install ? <Detail label={t("extensions.marketSource")}>{skill.install.package}</Detail> : null}<Detail label={t("extensions.installScope")}>{t(scope === "global" ? "extensions.global" : scope === "project" ? "extensions.project" : "extensions.installedSourcePath")}</Detail>{version ? <Detail label={t("extensions.marketVersionHash")}>{version}</Detail> : null}<Detail label={t("extensions.marketSkillFile")}>{skill.filePath}</Detail><Detail label={t("extensions.marketCurrentProject")}>{cwd}</Detail></InstallationDetails>
  </article>;
}
