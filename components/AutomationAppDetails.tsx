"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, EyeIcon, WorkflowIcon } from "lucide-react";
import type { AppCapability, AutomationAppDetail, AutomationAppIndex, AutomationAppUi, AutomationAppWorkflow, ManagedAutomationPlugin } from "@/lib/automation-app";
import { useI18n } from "@/hooks/useI18n";
import { ExtensionDetailsPanel, ExtensionDetailField } from "./ExtensionDetailsPanel";
import { OrganizationExtensionDetails, type OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import { CapabilityTypeBadge } from "./CapabilityTypeBadge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Alert, AlertDescription } from "./ui/alert";
import { MarkdownBody } from "./MarkdownBody";

export interface AutomationAppDetailsRequest {
  detail: AutomationAppDetail; index: AutomationAppIndex; cwd?: string;
  onChanged: () => void;
}


function StorageDetails({ detail }: { detail: AutomationAppDetail }) {
  const { t } = useI18n();
  return <Card className="rounded-[var(--radius-card)] shadow-none"><Collapsible>
    <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="h-auto w-full justify-between p-4 text-xs" />} >{t("automationUi.localFiles")}<ChevronDownIcon size={14} /></CollapsibleTrigger>
    <CollapsibleContent><CardContent className="space-y-3 pb-4 text-xs"><div><p className="text-[var(--text-muted)]">{t("automationUi.appCode")}</p><code className="mt-1 block break-all">{detail.codeDirectory}</code></div><div><p className="text-[var(--text-muted)]">{t("automationUi.localData")}</p><code className="mt-1 block break-all">{detail.dataDirectory}</code></div><div><p className="text-[var(--text-muted)]">{t("automationUi.publishedFiles")}</p><ul className="mt-1 space-y-1">{detail.files.map(file => <li key={file}>{file}</li>)}</ul></div></CardContent></CollapsibleContent>
  </Collapsible></Card>;
}

export function AutomationAppDetails({ request, onClose, onInstalledChange }: {
  request: AutomationAppDetailsRequest; onClose: () => void; onInstalledChange: () => void;
}) {
  const { detail } = request, managed = detail.install.managedPlugin;
  const { t, locale } = useI18n();
  const translation = useRef(t); translation.current = t;
  const capabilities: Record<AppCapability, string> = { "files.read": t("automationSettings.capability.files.read"), "files.write": t("automationSettings.capability.files.write"), "browser.read": t("automationSettings.capability.browser.read"), "browser.write": t("automationSettings.capability.browser.write"), ai: t("automationSettings.capability.ai"), clarification: t("automationSettings.capability.clarification"), artifacts: t("automationSettings.capability.artifacts") };
  const fieldTypes: Record<AutomationAppUi["fields"][number]["type"], string> = { text: t("automationUi.type.text"), number: t("automationUi.type.number"), boolean: t("automationUi.type.boolean"), date: t("automationUi.type.date"), percentage: t("automationUi.type.percentage"), object: t("automationUi.type.object"), list: t("automationUi.type.list"), file: t("automationUi.file"), directory: t("automationUi.directory") };
  const nodeKinds: Record<AutomationAppWorkflow["nodes"][number]["kind"], string> = { script: t("automationUi.node.script"), browser: t("automationUi.node.browser"), ai: t("automationSettings.capability.ai"), branch: t("automationUi.node.branch"), loop: t("automationUi.node.loop"), "wait-user": t("automationUi.node.waitUser") };
  const [tab, setTab] = useState("details");
  const [market, setMarket] = useState<OrganizationExtensionDetailItem | null>(null), [error, setError] = useState("");
  const [marketLocation, setMarketLocation] = useState<ManagedAutomationPlugin["locations"][number] | null>(null);
  const [loading, setLoading] = useState(Boolean(managed));
  useEffect(() => {
    if (!managed) return;
    const controller = new AbortController(); setLoading(true); setMarket(null); setMarketLocation(null); setError("");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const read = async (url: string) => { const response = await fetch(url, { cache: "no-store", signal }); if (!response.ok) throw new Error(); return response.json(); };
    const installedLocations = Promise.all(managed.locations.map(async original => {
      const location = original.scope === "global" && request.cwd ? { ...original, cwd: request.cwd } : original;
      try {
        const installed = await read(`/api/organization-extensions/${managed.capabilityId}/installation?${new URLSearchParams({cwd:location.cwd})}`);
        const entry = installed[location.scope]?.find((item: {capabilityId:string;type:string;version:string;disabled:boolean}) => item.capabilityId === managed.capabilityId && item.type === "Plugin");
        return entry ? { location, version: String(entry.version), disabled: Boolean(entry.disabled) } : null;
      } catch { return null; }
    }));
    void Promise.all([read("/api/organization-extensions?type=plugin"), installedLocations]).then(([payload, installed]) => {
      const item = payload.items?.find((item: OrganizationExtensionDetailItem) => item.id === managed.capabilityId && item.type === "Plugin");
      const available = installed.filter((item): item is NonNullable<typeof item> => item !== null).sort((a,b) => Number(b.location.scope === "global") - Number(a.location.scope === "global"));
      const source = available.find(item => !item.disabled && item.version === detail.manifest.version) ?? available.find(item => item.version === detail.manifest.version) ?? available[0];
      if (!item || !source) throw new Error();
      if (!controller.signal.aborted) { setMarketLocation(source.location); setMarket({ ...item, isInstalled: true, installedAt: detail.install.installedAt }); }
    }).catch(() => { if (!controller.signal.aborted) setError(translation.current("automationUi.marketDetailsUnavailable")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [managed, detail.install.installedAt, detail.manifest.version, request.cwd]);
  const storage = <StorageDetails detail={detail} />;
  if (market && managed && marketLocation) {
    const location = marketLocation;
    return <OrganizationExtensionDetails item={{ ...market, installScope: location.scope, installedScope: location.scope }} cwd={location.cwd} onClose={onClose} onFavoriteChange={(id, isFavorite) => setMarket(current => current?.id === id ? { ...current, isFavorite } : current)} onInstalledChange={onInstalledChange} extraDetails={storage} />;
  }
  return <ExtensionDetailsPanel name={detail.manifest.displayName} icon={managed ? <OrganizationCapabilityIcon capability={managed} size={40} fit="cover" className="bg-[var(--bg-hover)] text-[var(--text-muted)]" /> : <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--bg-hover)] text-[var(--text-muted)]"><WorkflowIcon size={22} aria-hidden="true" /></span>} badge={managed ? <CapabilityTypeBadge type="Plugin" /> : undefined} tab={tab} onTabChange={setTab} onClose={onClose} tabs={[{value:"details",label:t("extensions.details"),icon:<EyeIcon size={14} />},{value:"quickStart",label:t("extensions.quickStart")},{value:"readme",label:t("extensions.documentation")}]}>
    {loading ? <p role="status" className="text-sm text-[var(--text-muted)]">{t("extensions.contentLoading")}</p> : <>
      {error && <Alert className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
      {tab === "details" ? <div className="space-y-3">
        <Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-3"><CardTitle className="text-xs">{t("automationUi.basicInfo")}</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 pt-0 sm:grid-cols-3"><ExtensionDetailField label={t("automationUi.versionNumber")} value={detail.manifest.version} /><ExtensionDetailField label={t("automationUi.status")} value={detail.install.disabled ? t("automationUi.disabled") : t("automationUi.enabled")} /><ExtensionDetailField label={t("automationUi.updatedAt")} value={new Date(detail.install.updatedAt).toLocaleDateString(locale)} /></CardContent></Card>
        <Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="text-xs">{t("automationUi.description")}</CardTitle></CardHeader><CardContent className="p-4 pt-0"><p className="whitespace-pre-wrap text-xs leading-6 text-[var(--text-muted)]">{detail.manifest.description || t("automationUi.noDescription")}</p><div className="mt-3 flex flex-wrap gap-1.5">{detail.manifest.automation.capabilities.map(capability => <span key={capability} className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{capabilities[capability]}</span>)}</div></CardContent></Card>{storage}
      </div> : tab === "quickStart" ? <div className="space-y-3">
        <Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="text-xs">{t("automationUi.parameters")}</CardTitle></CardHeader><CardContent className="space-y-3 p-4 pt-0 text-xs">{detail.ui.fields.map(field => <div key={field.id}><p className="font-semibold">{field.label}{field.required ? " *" : ""}</p><p className="mt-1 text-[var(--text-muted)]">{fieldTypes[field.type]}{field.description ? ` · ${field.description}` : ""}</p></div>)}{!detail.ui.fields.length && <p className="text-[var(--text-muted)]">{t("automationUi.noParameters")}</p>}</CardContent></Card>
        <Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="text-xs">{t("automationUi.workflow")}</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-xs"><ol className="list-decimal space-y-2 pl-4">{detail.workflow.nodes.map(node => <li key={node.id}>{node.label}<span className="ml-2 text-[var(--text-muted)]">{nodeKinds[node.kind]}</span></li>)}</ol></CardContent></Card>
        <Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="text-xs">{t("automationUi.outputs")}</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-xs text-[var(--text-muted)]">{detail.ui.results.columns.map(column => column.label).join(locale === "zh-CN" ? "、" : ", ") || t("automationUi.noColumns")}</CardContent></Card>
      </div> : detail.readme.trim() ? <MarkdownBody className="text-sm" isStreaming={false}>{detail.readme}</MarkdownBody> : <p className="text-xs text-[var(--text-muted)]">{t("extensions.noContent")}</p>}
    </>}
  </ExtensionDetailsPanel>;
}
