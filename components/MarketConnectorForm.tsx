"use client";

import { useI18n } from "@/hooks/useI18n";
import type { McpConfigScope, McpRuntimeStatus, McpServerInput } from "@/lib/api-types";
import { ChevronDownIcon, CircleHelpIcon, FolderIcon, GlobeIcon, SaveIcon, Settings2Icon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const controlClass = "h-[36px] w-full min-w-0 rounded-[var(--radius-control)] bg-[var(--bg-panel)] text-[13px] transition-[border-color,box-shadow] focus-visible:border-[color-mix(in_srgb,var(--text-muted)_55%,var(--border))] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text)_8%,transparent)]";
const labelClass = "flex min-w-0 flex-col gap-2 text-[12px]";

function ConnectorSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const labels = options.map(option => option.label);
  return <label className={labelClass}><span>{label}</span><Combobox items={labels} value={options.find(option => option.value === value)?.label ?? labels[0]} onValueChange={label => { const selected = options.find(option => option.label === label); if (selected) onChange(selected.value); }}>
    <div className="relative"><ComboboxInput aria-label={label} className={`${controlClass} pr-9`} /><ChevronDownIcon size={14} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /></div>
    <ComboboxContent className="rounded-[var(--radius-control)]"><ComboboxList>{(option: string) => <ComboboxItem key={option} value={option} className="text-[13px] [&_svg]:text-[var(--text)]">{option}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox></label>;
}

export function MarketConnectorForm({ form, scope, savedPath, isNew, busy, canSave, sessionId, status, onChange, onTransportChange, onSave, onToggleDisabled, onUninstall, uninstalling = false }: {
  form: McpServerInput;
  scope: McpConfigScope;
  savedPath: string;
  isNew: boolean;
  busy: boolean;
  canSave: boolean;
  sessionId: string | null;
  status: McpRuntimeStatus | null;
  onChange: <K extends keyof McpServerInput>(key: K, value: McpServerInput[K]) => void;
  onTransportChange: (transport: McpServerInput["transport"]) => void;
  onSave: () => void;
  onToggleDisabled: () => void;
  onUninstall?: () => void;
  uninstalling?: boolean;
}) {
  const { t } = useI18n();
  const lifecycle = form.lifecycle ?? "lazy";
  return <div data-market-connector-form="" className="@container w-full text-[13px] text-[var(--text)]">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="mb-1 text-[17px] font-semibold">{isNew ? t("extensions.connectorAdd") : t("extensions.connectorEdit", { name: form.name })}</h2><p className="text-[12px] text-[var(--text-muted)]">{t("extensions.connectorDescription")}</p></div>{!isNew ? <label className="ml-auto flex items-center gap-2 text-[12px] text-[var(--text-muted)]">{t(form.disabled ? "i18n.disabled" : "extensions.managementEnabled")}<Switch aria-label={t(form.disabled ? "extensions.connectorEnable" : "extensions.connectorDisable")} checked={!form.disabled} disabled={busy} onCheckedChange={onToggleDisabled} /></label> : null}</div>
    <fieldset disabled={busy} className="min-w-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4 @min-[560px]:p-5">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Settings2Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />{t("extensions.connectorConnectionConfig")}</h3>
      <div className="grid grid-cols-1 items-start gap-4 @min-[560px]:grid-cols-2"><label className={labelClass}><span>{t("extensions.connectorName")}</span><Input value={form.name} onChange={event => onChange("name", event.target.value)} autoComplete="off" spellCheck={false} placeholder={t("extensions.connectorNamePlaceholder")} className={controlClass} /></label><ConnectorSelect label={t("extensions.connectorTransport")} value={form.transport} options={[{ value: "stdio", label: t("extensions.connectorTransportStdio") }, { value: "http", label: t("extensions.connectorTransportHttp") }]} onChange={value => onTransportChange(value === "http" ? "http" : "stdio")} /></div>
      <div className="mt-4 flex flex-col gap-4">
        {form.transport === "stdio" ? <>
          <label className={labelClass}><span>{t("extensions.connectorCommand")}</span><Input value={form.command ?? ""} onChange={event => onChange("command", event.target.value)} placeholder="npx" autoComplete="off" spellCheck={false} className={`${controlClass} font-mono`} /></label>
          <label className={labelClass}><span>{t("extensions.connectorArgs")}</span><Textarea value={(form.args ?? []).join("\n")} onChange={event => onChange("args", event.target.value.split(/\r?\n/))} placeholder={"-y\n@scope/mcp-server"} spellCheck={false} className="h-[82px] min-h-[68px] bg-[var(--bg-panel)] font-mono text-[12px]" /></label>
          <details><summary className="w-fit cursor-pointer rounded text-[12px] text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t("extensions.connectorWorkingDirectoryOptional")}</summary><label className={`${labelClass} mt-3`}><span>{t("extensions.connectorWorkingDirectory")}</span><Input value={form.cwd ?? ""} onChange={event => onChange("cwd", event.target.value)} autoComplete="off" spellCheck={false} className={`${controlClass} font-mono`} /></label></details>
        </> : <>
          <label className={labelClass}><span>{t("extensions.connectorUrl")}</span><Input value={form.url ?? ""} onChange={event => onChange("url", event.target.value)} placeholder="https://example.com/mcp" autoComplete="off" spellCheck={false} className={`${controlClass} font-mono`} /></label>
          <details><summary className="w-fit cursor-pointer rounded text-[12px] text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t("extensions.connectorAuthOptional")}</summary><label className={`${labelClass} mt-3`}><span>{t("extensions.connectorBearerEnv")}</span><Input aria-label={t("extensions.connectorBearerEnv")} value={form.bearerTokenEnv ?? ""} onChange={event => onChange("bearerTokenEnv", event.target.value)} placeholder="MCP_TOKEN" autoComplete="off" spellCheck={false} className={`${controlClass} font-mono`} /><span className="text-[11px] text-[var(--text-muted)]">{t("extensions.connectorBearerEnvHint")}</span></label></details>
        </>}
      </div>
      <section className="mt-5 border-t border-[var(--border)] pt-5"><h3 className="mb-4 flex items-center gap-2 font-semibold"><SlidersHorizontalIcon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />{t("extensions.connectorRuntimeSettings")}<Tooltip><TooltipTrigger render={<button type="button" aria-label={t("extensions.connectorRuntimeHelp")} className="rounded text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><CircleHelpIcon size={13} aria-hidden="true" /></button>} /><TooltipContent>{t("extensions.connectorRuntimeHelp")}</TooltipContent></Tooltip></h3>
        <div className="grid grid-cols-1 items-start gap-4 @min-[560px]:grid-cols-2"><div className="min-w-0"><ConnectorSelect label={t("extensions.connectorPolicy")} value={lifecycle} options={[{ value: "lazy", label: t("extensions.connectorPolicyLazy") }, { value: "eager", label: t("extensions.connectorPolicyEager") }, { value: "keep-alive", label: t("extensions.connectorPolicyKeepAlive") }]} onChange={value => onChange("lifecycle", value as McpServerInput["lifecycle"])} /><p className="mt-2 text-[11px] text-[var(--text-muted)]">{t(lifecycle === "eager" ? "extensions.lifecycle.eager" : lifecycle === "keep-alive" ? "extensions.lifecycle.keepAlive" : "extensions.lifecycle.lazy")}</p></div><label className={labelClass}><span>{t("extensions.connectorIdleMinutes")}</span><Input type="number" value={form.idleTimeout ?? 10} onChange={event => onChange("idleTimeout", Number(event.target.value))} className={controlClass} /></label></div>
      </section>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4"><div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]"><span className="inline-flex items-center gap-1.5">{scope === "global" ? <GlobeIcon size={14} aria-hidden="true" /> : <FolderIcon size={14} aria-hidden="true" />}{t(scope === "global" ? "extensions.connectorSaveGlobal" : "extensions.connectorSaveProject")}</span><Tooltip><TooltipTrigger render={<button type="button" className="inline-flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t("extensions.connectorConfigLocation")}<CircleHelpIcon size={13} aria-hidden="true" /></button>} /><TooltipContent className="break-all font-mono">{savedPath}</TooltipContent></Tooltip></div><div className="ml-auto flex items-center gap-2">{!isNew && onUninstall ? <Button type="button" variant="destructive" size="sm" className="h-[36px] shrink-0 gap-1.5 text-[13px]" disabled={busy} onClick={onUninstall}><Trash2Icon size={15} aria-hidden="true" />{t(uninstalling ? "extensions.marketUninstalling" : "extensions.uninstall")}</Button> : null}<Button type="button" size="sm" className="h-[36px] shrink-0 gap-1.5 text-[13px]" disabled={busy || !canSave} onClick={onSave}><SaveIcon size={15} aria-hidden="true" />{t(busy && !uninstalling ? "i18n.saving" : "extensions.connectorSave")}</Button></div></div>
    </fieldset>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-[var(--text-muted)]">
      <p>{t("extensions.connectorSaveHint")}</p>
      <p className="ml-auto text-right">{!sessionId ? t("extensions.connectorNoSession") : status ? t("extensions.connectorSessionTools", { count: status.totalTools, time: new Date(status.updatedAt).toLocaleTimeString() }) : t("extensions.connectorAwaitingStatus")}</p>
    </div>
  </div>;
}
