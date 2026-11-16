"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { DEFAULT_PUBLICATION_AI_SETTINGS, parsePublicationAiSettings, PUBLICATION_AI_MAX_TIMEOUT_MS, PUBLICATION_AI_MAX_OUTPUT_TOKENS, type PublicationAiSettings } from "@/lib/automation-publication-ai-settings";
import { SettingsCard, SettingsRow, SettingsSection } from "./SettingsLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AutomationPublicationModelPicker } from "./AutomationPublicationModelPicker";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

type Model = { provider: string; id: string; name: string };
type Models = { modelList: Model[]; defaultModel: { provider: string; modelId: string } | null; thinkingLevels: Record<string, string[]> };
type View = { ownerKey: string; runtimeId: string; publicationAi: PublicationAiSettings };
const modelKey = (model: { provider: string; modelId: string }) => JSON.stringify([model.provider, model.modelId]);

export function AutomationPublicationAiSettings() {
  const { t } = useI18n();
  const [view, setView] = useState<View | null>(null), [models, setModels] = useState<Models | null>(null);
  const [draft, setDraft] = useState<PublicationAiSettings>(DEFAULT_PUBLICATION_AI_SETTINGS);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false), [reload, setReload] = useState(0);
  const saving = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
    setView(null); setError(""); setSaved(false);
    void (async () => {
      try {
        const responses = await Promise.all([fetch("/api/automation/settings", { cache: "no-store", signal }), fetch("/api/models?scope=global", { signal })]);
        const [settings, catalog] = await Promise.all(responses.map(response => response.json()));
        if (!responses[0].ok || !responses[1].ok || !settings.ownerKey || !settings.runtimeId || !settings.publicationAi || !Array.isArray(catalog.modelList) || catalog.error) throw new Error(settings.error || catalog.error || t("automationSettings.requestFailed"));
        if (!abort.signal.aborted) { setView(settings); setDraft(parsePublicationAiSettings(settings.publicationAi)); setModels(catalog); }
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t("automationSettings.requestFailed")); }
    })();
    return () => { abort.abort(); controller.current?.abort(); };
  }, [t, reload]);

  const selectedModel = draft.model ?? models?.defaultModel;
  const levels = selectedModel ? models?.thinkingLevels[`${selectedModel.provider}:${selectedModel.modelId}`] ?? [] : [];
  const items = [{ value: "default", name: t("automationSettings.aiDefaultModel"), provider: t("automationSettings.aiDefaultGroup"), modelId: "default" }, ...(models?.modelList ?? []).map(model => ({ value: modelKey({ provider: model.provider, modelId: model.id }), name: model.name, provider: model.provider, modelId: model.id }))];
  if (draft.model && !items.some(item => item.value === modelKey(draft.model!))) items.push({ value: modelKey(draft.model), name: draft.model.modelId, provider: draft.model.provider, modelId: draft.model.modelId });
  const validLimits = Number.isSafeInteger(draft.timeoutMs) && draft.timeoutMs >= 10000 && draft.timeoutMs <= PUBLICATION_AI_MAX_TIMEOUT_MS && draft.timeoutMs % 1000 === 0 && Number.isSafeInteger(draft.maxTokens) && draft.maxTokens >= 256 && draft.maxTokens <= PUBLICATION_AI_MAX_OUTPUT_TOKENS;
  const thinkingItems = [{ value: "auto", label: t("automationSettings.aiAuto") }, ...levels.map(value => ({ value, label: t(`automationSettings.aiThinking.${value}`) }))];
  if (draft.thinkingLevel && !thinkingItems.some(item => item.value === draft.thinkingLevel)) thinkingItems.push({ value: draft.thinkingLevel, label: t(`automationSettings.aiThinking.${draft.thinkingLevel}`) });
  function change(value: PublicationAiSettings) { setDraft(value); setSaved(false); setError(""); }
  async function save() {
    if (!view || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setSaved(false);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/automation/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerKey: view.ownerKey, runtimeId: view.runtimeId, publicationAi: draft }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("automationSettings.requestFailed"));
      if (!abort.signal.aborted) { setView(data); setDraft(data.publicationAi); setSaved(true); }
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t("automationSettings.requestFailed")); }
    finally { saving.current = false; if (!abort.signal.aborted) setBusy(false); }
  }
  return <SettingsSection title={t("automationSettings.aiTitle")} description={t("automationSettings.aiDescription")}>
    <SettingsCard className="divide-y divide-[var(--border)] px-4">
      <SettingsRow label={t("automationSettings.aiModel")} description={t("automationSettings.aiModelDescription")} htmlFor="publication-ai-model">
        <div className="flex flex-wrap items-center gap-3">
          <AutomationPublicationModelPicker items={items} value={draft.model ? modelKey(draft.model) : "default"} disabled={!view || busy} onChange={value => { const model = value === "default" ? null : JSON.parse(value) as [string, string]; change({ ...draft, model: model ? { provider: model[0], modelId: model[1] } : null, thinkingLevel: null }); }}/>
          <label htmlFor="publication-ai-thinking" className="text-xs text-[var(--text-muted)]">{t("automationSettings.aiThinking")}</label>
        <Select items={thinkingItems} value={draft.thinkingLevel ?? "auto"} disabled={!view || busy} onValueChange={value => { if (value) change({ ...draft, thinkingLevel: value === "auto" ? null : value as PublicationAiSettings["thinkingLevel"] }); }}>
          <SelectTrigger id="publication-ai-thinking" className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>{thinkingItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        </div>
      </SettingsRow>
      <div className="grid grid-cols-2 gap-4 py-[14px]">
        <div className="flex min-w-0 flex-col gap-2"><label htmlFor="publication-ai-timeout" className="text-[13px] font-medium">{t("automationSettings.aiTimeout")}</label><Input id="publication-ai-timeout" type="number" min={10} max={PUBLICATION_AI_MAX_TIMEOUT_MS / 1000} step={1} value={draft.timeoutMs / 1000 || ""} disabled={!view || busy} onChange={event => change({ ...draft, timeoutMs: Number(event.target.value) * 1000 })}/><span className="text-[11px] text-[var(--text-muted)]">{t("automationSettings.aiTimeoutHint")}</span></div>
        <div className="flex min-w-0 flex-col gap-2"><label htmlFor="publication-ai-tokens" className="text-[13px] font-medium">{t("automationSettings.aiTokens")}</label><Input id="publication-ai-tokens" type="number" min={256} max={PUBLICATION_AI_MAX_OUTPUT_TOKENS} step={1} value={draft.maxTokens || ""} disabled={!view || busy} onChange={event => change({ ...draft, maxTokens: Number(event.target.value) })}/><span className="text-[11px] text-[var(--text-muted)]">{t("automationSettings.aiTokensHint")}</span></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-[14px]">
        <span role="status" className="text-xs text-[var(--text-muted)]">{saved ? t("automationSettings.aiSaved") : null}</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{t("automationSettings.aiReload")}</Button><Button size="sm" disabled={!view || busy || !validLimits} onClick={() => void save()}>{t(busy ? "automationSettings.aiSaving" : "automationSettings.aiSave")}</Button></div>
      </div>
    </SettingsCard>
    {error && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
  </SettingsSection>;
}
