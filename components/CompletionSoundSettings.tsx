"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getCompletionSoundPreference, setCompletionSoundPreference, subscribeCompletionSoundPreference } from "@/lib/completion-sound-preference";
import { Switch } from "./ui/switch";
import { SettingsRow } from "./SettingsLayout";

export function CompletionSoundSettings() {
  const { t } = useI18n();
  const enabled = useSyncExternalStore(subscribeCompletionSoundPreference, getCompletionSoundPreference, () => true);
  return (
    <SettingsRow label={t("settings.completionSound")} description={t("settings.completionSoundDescription")} htmlFor="completion-sound-enabled" descriptionId="completion-sound-description">
      <Switch id="completion-sound-enabled" aria-describedby="completion-sound-description" checked={enabled} onCheckedChange={setCompletionSoundPreference} />
    </SettingsRow>
  );
}
