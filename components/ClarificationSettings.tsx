"use client";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getClarificationPreference, setClarificationPreference, subscribeClarificationPreference } from "@/lib/clarification-preference";
import { Switch } from "./ui/switch";
import { SettingsRow } from "./SettingsLayout";

export function ClarificationSettings() {
  const { t } = useI18n();
  const enabled = useSyncExternalStore(subscribeClarificationPreference, getClarificationPreference, () => false);
  return <SettingsRow label={t("clarification.title")} description={t("clarification.settingDescription")} htmlFor="clarification-enabled">
    <Switch id="clarification-enabled" checked={enabled} onCheckedChange={setClarificationPreference} />
  </SettingsRow>;
}
