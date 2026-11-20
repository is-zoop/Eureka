"use client";
import { useEffect, useState } from "react";
import { SettingsRow } from "../../../components/SettingsLayout";
import { SettingsSelect } from "./SettingsSelect";
import { useI18n } from "@/hooks/useI18n";
export function CacheWarmingSettings() {
  const { t } = useI18n();
  const [mode, setMode] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => { const c = new AbortController(); void fetch("/api/settings/cache-warming", { signal: c.signal }).then(async r => { if (!r.ok) throw Error(); setMode((await r.json()).mode); }).catch(() => { if (!c.signal.aborted) setError(true); }); return () => c.abort(); }, []);
  return <SettingsRow label={t("sdk.cache")} description={t(error ? "sdk.error" : "sdk.cacheHint")}><SettingsSelect label={t("sdk.cache")} value={mode ?? "streaming"} disabled={mode === null || busy} options={["off", "streaming", "idle"].map(value => ({ value, label: t(`sdk.${value}`) }))} onValueChange={async value => { setBusy(true); setError(false); try { const r = await fetch("/api/settings/cache-warming", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: value }) }); if (!r.ok) throw Error(); setMode((await r.json()).mode); } catch { setError(true); } finally { setBusy(false); } }}/></SettingsRow>;
}
