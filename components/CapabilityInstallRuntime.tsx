"use client";

import type { ReactNode } from "react";
import { CircleHelpIcon, FolderIcon, GlobeIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const states = {
  installed: { color: "var(--capability-connector-text)", backgroundColor: "var(--capability-connector-bg)" },
  loaded: { color: "var(--capability-skill-text)", backgroundColor: "var(--capability-skill-bg)" },
  disabled: { color: "var(--text-muted)", backgroundColor: "var(--bg-hover)" },
  "pending-reload": { color: "var(--code-string)", backgroundColor: "var(--bg-hover)" },
  "needs-auth": { color: "var(--code-string)", backgroundColor: "var(--bg-hover)" },
  failed: { color: "var(--danger)", backgroundColor: "var(--danger-hover)" },
};

export function CapabilityInstallRuntime({ scope, version, latestVersion, versionFormat = "release", versionStatus, state = "installed", actions }: {
  scope: "global" | "project" | "path";
  version: string;
  latestVersion?: string;
  versionFormat?: "release" | "hash";
  versionStatus?: ReactNode;
  state?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const status = Object.hasOwn(states, state) ? state as keyof typeof states : "installed";
  const ScopeIcon = scope === "global" ? GlobeIcon : FolderIcon;
  const formatVersion = (value: string) => versionFormat === "hash" ? value.trim().slice(0, 8) : `V${value.trim().replace(/^v/i, "")}`;
  return <section data-install-runtime className="border-b border-[var(--border)] pb-5" aria-label={t("extensions.installationRuntime")}>
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold">{t("extensions.installationRuntime")}</h3>
      <Tooltip><TooltipTrigger render={<button type="button" aria-label={t("extensions.installationRuntimeHelp")} className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><CircleHelpIcon size={14} aria-hidden="true" /></button>} /><TooltipContent side="bottom" align="start">{t("extensions.managementReloadHint")}</TooltipContent></Tooltip>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5"><ScopeIcon size={15} aria-hidden="true" />{t(scope === "global" ? "extensions.global" : scope === "project" ? "extensions.project" : "extensions.installedSourcePath")}</span>
        <span data-installation-state={status} className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium" style={states[status]}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{t(`extensions.pluginState.${status}`)}</span>
        <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">{versionFormat === "hash" ? <span className="text-xs text-[var(--text-muted)]">{t("extensions.marketVersionHash")}</span> : null}{versionFormat === "hash" && version.trim() ? <Tooltip><TooltipTrigger render={<span className="break-all font-mono">{formatVersion(version)}</span>} /><TooltipContent className="break-all font-mono">{version}</TooltipContent></Tooltip> : <span>{version.trim() ? formatVersion(version) : "—"}</span>}{versionStatus ? <span role="status" className="whitespace-nowrap text-xs text-[var(--text-muted)]">{versionStatus}</span> : null}</span>
        {latestVersion && <span data-latest-install-version className="text-xs text-[var(--text-dim)]">{t("extensions.latestVersion")} {formatVersion(latestVersion)}</span>}
      </div>
      {actions && <div data-install-runtime-actions className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </section>;
}
