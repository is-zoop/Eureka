"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getPreferredToolPreset, setPreferredToolPreset, subscribeToolPresetPreference } from "@/lib/tool-preset-preference";
import { isToolPreset } from "@/lib/tool-presets";
import { toolPermissionOptions, type SessionToolPermissions } from "@/lib/tool-permissions";
import { SettingsSelect } from "./SettingsSelect";
import { SettingsRow } from "./SettingsLayout";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "./ui/dropdown-menu";

function PermissionsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z" /><path d="m8 12 3 3 5-5" /></svg>;
}

export function SessionToolPermissionsMenu({ controls }: { controls: SessionToolPermissions | null }) {
  const { t } = useI18n();
  return <DropdownMenuSub onOpenChange={(open) => { if (open) void controls?.load(); }}>
    <DropdownMenuSubTrigger disabled={!controls}>
      <PermissionsIcon /><span>{t("chat.toolPermissions")}</span>
      {controls?.ready && <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 }}>{t(`toolPermissions.preset.${controls.pendingPreset ?? controls.preset}`)}</span>}
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      <SessionToolPermissionItems controls={controls} />
    </DropdownMenuSubContent>
  </DropdownMenuSub>;
}

function SessionToolPermissionItems({ controls }: { controls: SessionToolPermissions | null }) {
  const { t } = useI18n();
  const options = toolPermissionOptions(t);
  return <>
      {controls?.loading && <p role="status" style={{ margin: 8, fontSize: 12 }}>{t("toolPermissions.loading")}</p>}
      <DropdownMenuRadioGroup value={controls?.pendingPreset ?? (controls?.ready ? controls.preset : "")} onValueChange={(value) => { if (isToolPreset(value)) void controls?.change(value); }}>
        {options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value} indicatorPosition="start" disabled={!controls || controls.saving || controls.locked} className="focus:bg-[var(--bg-hover)] focus:text-[var(--text)] focus:**:text-[var(--text)]" style={({ highlighted }) => ({ minHeight: 48, padding: "8px 8px 8px 30px", background: highlighted ? "var(--bg-hover)" : "transparent", color: "var(--text)" })}>
          <span style={{ display: "grid", gap: 3 }}><span>{option.label}</span><span style={{ color: "var(--text-muted)", fontSize: 11 }}>{option.description}</span></span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {(controls?.locked || controls?.pendingPreset || controls?.saving) && <p role="status" style={{ margin: 8, fontSize: 11, color: "var(--text-muted)" }}>{t(controls.locked ? "toolPermissions.locked" : controls.saving ? "toolPermissions.saving" : "toolPermissions.pending")}</p>}
  </>;
}

export function SessionToolPermissionsButton({ controls }: { controls: SessionToolPermissions | null }) {
  const { t } = useI18n();
  return <DropdownMenu onOpenChange={(open) => { if (open) void controls?.load(); }}>
    <DropdownMenuTrigger disabled={!controls} aria-label={t("chat.toolPermissions")} title={t("chat.toolPermissions")} data-mobile-toolbar-action="permissions" style={{ display: "grid", placeItems: "center", width: 36, height: "100%", padding: 0, border: 0, borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}><PermissionsIcon /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" style={{ width: "max-content", maxWidth: "calc(100vw - 24px)", background: "var(--bg-panel)", color: "var(--text)", border: "1px solid var(--border)" }}><SessionToolPermissionItems controls={controls} /></DropdownMenuContent>
  </DropdownMenu>;
}

export function DefaultToolPermissionsSettings() {
  const { t } = useI18n();
  const preset = useSyncExternalStore(subscribeToolPresetPreference, getPreferredToolPreset, () => "default");
  return <SettingsRow label={t("toolPermissions.defaultTitle")} description={t("toolPermissions.defaultDescription")}>
    <SettingsSelect label={t("toolPermissions.defaultTitle")} value={preset} options={toolPermissionOptions(t)} onValueChange={(next) => { if (isToolPreset(next)) setPreferredToolPreset(next); }} />
  </SettingsRow>;
}
