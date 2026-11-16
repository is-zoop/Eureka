"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SettingsRow } from "./SettingsLayout";
import { SettingsSelect } from "./SettingsSelect";
import type { CommandEnvironment } from "@/lib/command-environment";

export function CommandEnvironmentSettings() {
  const { t } = useI18n();
  const [view, setView] = useState<{ environment: CommandEnvironment; powershellAvailable: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/settings/command-environment", { signal: abort.signal, cache: "no-store" }).then(async response => { if (!response.ok) throw new Error(); const result = await response.json(); if (!abort.signal.aborted) setView(result); }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, []);
  return <SettingsRow label={t("settings.commandEnvironment")} description={t(error ? "settings.commandEnvironmentError" : "settings.commandEnvironmentHint")}>
    <SettingsSelect label={t("settings.commandEnvironment")} value={view?.environment ?? "bash"} disabled={!view || busy} options={[{ value: "bash", label: "Bash" }, ...(view?.powershellAvailable ? [{ value: "powershell", label: "PowerShell" }] : [])]} onValueChange={async value => {
      if (busy) return; setBusy(true); setError(false);
      try { const response = await fetch("/api/settings/command-environment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: value }), signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(); setView(await response.json()); }
      catch { setError(true); } finally { setBusy(false); }
    }} />
  </SettingsRow>;
}
