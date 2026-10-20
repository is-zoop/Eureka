"use client";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getClarificationPreference, setClarificationPreference, subscribeClarificationPreference } from "@/lib/clarification-preference";
import { Switch } from "./ui/switch";

export function ClarificationSettings() {
  const { t } = useI18n();
  const enabled = useSyncExternalStore(subscribeClarificationPreference, getClarificationPreference, () => false);
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "14px 0", borderTop: "1px solid var(--border)" }}>
    <div><label htmlFor="clarification-enabled" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{t("clarification.title")}</label><p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("clarification.settingDescription")}</p></div>
    <Switch id="clarification-enabled" checked={enabled} onCheckedChange={setClarificationPreference} />
  </div>;
}
