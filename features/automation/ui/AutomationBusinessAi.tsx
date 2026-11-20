"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AutomationAppDetail, AutomationAppIndex } from "@/features/automation/shared/automation-app";
import { DEFAULT_BUSINESS_AI, parseBusinessAi, type BusinessAiSettings } from "@/features/automation/runtime/automation-business-ai";
import { AutomationPublicationModelPicker } from "./AutomationPublicationModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AutomationBusinessAi({ detail, index, disabled }: { detail: AutomationAppDetail; index: AutomationAppIndex; disabled: boolean }) {
  const { t } = useI18n(), [draft, setDraft] = useState<BusinessAiSettings>(DEFAULT_BUSINESS_AI), [revision, setRevision] = useState<number | null>(null);
  const [models, setModels] = useState<{ modelList: { provider: string; id: string; name: string }[]; defaultModel?: { provider: string; modelId: string }; thinkingLevels: Record<string, string[]> }>({ modelList: [], thinkingLevels: {} });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [reload, setReload] = useState(0);
  const [classifiers, setClassifiers] = useState<{ provider: string; id: string; name: string }[]>([]);
  const [classifierError, setClassifierError] = useState(false);
  const endpoint = `/api/automation/apps/${detail.install.id}/ai`;
  useEffect(() => {
    const controller = new AbortController(); setRevision(null); setError("");
    setClassifierError(false);
    void fetch("/api/automation/classifier-models", { signal: controller.signal, cache: "no-store" }).then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) setClassifiers(data.models); }).catch(() => { if (!controller.signal.aborted) setClassifierError(true); });
    void (async () => { try {
      const responses = await Promise.all([fetch(endpoint, { signal: controller.signal, cache: "no-store" }), fetch("/api/models", { signal: controller.signal })]);
      const [config, catalog] = await Promise.all(responses.map(r => r.json()));
      if (!responses.every(r => r.ok)) throw new Error(config.error || catalog.error || t("automationSettings.requestFailed"));
      if (!controller.signal.aborted) { setDraft(parseBusinessAi(config.settings)); setRevision(config.revision); setModels(catalog); }
    } catch (cause) { if (!controller.signal.aborted) setError((cause as Error).message); } })();
    return () => controller.abort();
  }, [endpoint, reload, t]);
  const model = draft.model ?? models.defaultModel, key = (value: { provider: string; modelId: string }) => JSON.stringify([value.provider, value.modelId]);
  const items = [{ value: "default", name: t("automationSettings.aiDefaultModel"), provider: t("automationSettings.aiDefaultGroup"), modelId: "default" }, ...models.modelList.map(m => ({ value: key({ provider: m.provider, modelId: m.id }), name: m.name, provider: m.provider, modelId: m.id }))];
  if (draft.model && !items.some(i => i.value === key(draft.model!))) items.push({ value: key(draft.model), name: draft.model.modelId, provider: draft.model.provider, modelId: draft.model.modelId });
  const levels = [{ value: "auto", label: t("automationSettings.aiAuto") }, ...(model ? models.thinkingLevels[`${model.provider}:${model.modelId}`] ?? [] : []).map(value => ({ value, label: t(`automationSettings.aiThinking.${value}`) }))];
  if (draft.thinkingLevel && !levels.some(i => i.value === draft.thinkingLevel)) levels.push({ value: draft.thinkingLevel, label: t(`automationSettings.aiThinking.${draft.thinkingLevel}`) });
  const classifierItems = [{ value: "none", name: t("automationUi.classifierDisabled"), provider: t("automationSettings.aiDefaultGroup"), modelId: "none" }, ...classifiers.map(m => ({ value: key({ provider: m.provider, modelId: m.id }), name: m.name, provider: m.provider, modelId: m.id }))];
  if (draft.classifierModel && !classifierItems.some(item => item.value === key(draft.classifierModel!))) classifierItems.push({ value: key(draft.classifierModel), name: draft.classifierModel.modelId, provider: draft.classifierModel.provider, modelId: draft.classifierModel.modelId });
  const locked = disabled || busy || revision === null;
  function change(next: BusinessAiSettings) { setDraft(next); setSaved(false); }
  async function save() {
    setBusy(true); setError(""); try {
      const settings = parseBusinessAi(draft), response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerKey: index.ownerKey, runtimeId: index.runtimeId, revision: detail.install.revision, configRevision: revision, settings }), signal: AbortSignal.timeout(15000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); setDraft(result.settings); setRevision(result.revision); setSaved(true);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="space-y-4 py-3">
    <p className="text-xs text-[var(--text-muted)]">{t("automationUi.businessAiHint")}</p>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="business-ai-model">{t("automationUi.businessAiModel")}</label>
        <AutomationPublicationModelPicker fullWidth id="business-ai-model" label={t("automationUi.businessAiModel")} items={items} value={draft.model ? key(draft.model) : "default"} disabled={locked} onChange={value => { const [provider, modelId] = value === "default" ? [] : JSON.parse(value); change({ ...draft, model: value === "default" ? null : { provider, modelId }, thinkingLevel: null }); }}/>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="business-ai-thinking">{t("automationSettings.aiThinking")}</label>
        <Select items={levels} value={draft.thinkingLevel ?? "auto"} disabled={locked} onValueChange={value => { if (value) change({ ...draft, thinkingLevel: value === "auto" ? null : value as BusinessAiSettings["thinkingLevel"] }); }}><SelectTrigger id="business-ai-thinking"><SelectValue/></SelectTrigger><SelectContent>{levels.map(level => <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="business-ai-classifier">{t("automationUi.classifierModel")}</label>
        <AutomationPublicationModelPicker fullWidth id="business-ai-classifier" label={t("automationUi.classifierModel")} items={classifierItems} value={draft.classifierModel ? key(draft.classifierModel) : "none"} disabled={locked} onChange={value => { const [provider, modelId] = value === "none" ? [] : JSON.parse(value); change({ ...draft, classifierModel: value === "none" ? null : { provider, modelId } }); }}/>
        {classifierError && <span role="status" className="text-xs text-[var(--text-muted)]">{t("automationUi.classifierLoadError")}</span>}
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="flex min-w-0 flex-col gap-2">{t("automationSettings.aiTimeout")}<Input type="number" min={10} max={1800} value={draft.timeoutMs / 1000} disabled={locked} onChange={e => change({ ...draft, timeoutMs: Number(e.target.value) * 1000 })}/></label><label className="flex min-w-0 flex-col gap-2">{t("automationSettings.aiTokens")}<Input type="number" min={256} max={128000} value={draft.maxTokens} disabled={locked} onChange={e => change({ ...draft, maxTokens: Number(e.target.value) })}/></label></div>
    {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { setSaved(false); setReload(n => n + 1); }}>{t("automationSettings.aiReload")}</Button><Button disabled={locked} onClick={() => void save()}>{t(saved ? "automationUi.saved" : "automationUi.saveConfig")}</Button></div>
  </div>;
}
