"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { GeneratedImageRecord } from "@/lib/generated-images";
import { saveFileAs } from "@/lib/save-file";
import { ImagePreview } from "./ImagePreview";
import { Button } from "./ui/button";
import { SettingsCard } from "./SettingsLayout";

export function generatedImageId(toolName: string, details: unknown): string | undefined {
  if (toolName !== "eureka_generate_image" || !details || typeof details !== "object") return;
  const image = (details as { eurekaGeneratedImage?: { id?: unknown } }).eurekaGeneratedImage;
  return typeof image?.id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(image.id) ? image.id : undefined;
}
export function GeneratedImageResult({ id }: { id: string }) {
  const { t } = useI18n();
  const [item, setItem] = useState<GeneratedImageRecord>(), [error, setError] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); setError(false); setItem(undefined);
    void fetch(`/api/generated-images?id=${encodeURIComponent(id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), cache: "no-store" }).then(async response => {
      if (!response.ok) throw Error(); const data = await response.json();
      if (data.item?.id !== id || data.item.status !== "completed") throw Error();
      if (!controller.signal.aborted) setItem(data.item);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { alive.current = false; controller.abort(); };
  }, [id]);
  const endpoint = `/api/generated-images/${encodeURIComponent(id)}/content`;
  async function save() {
    if (!item || saving) return;
    setSaving(true); setSaveError(false);
    const extension = item.mimeType === "image/jpeg" ? "jpg" : item.mimeType === "image/webp" ? "webp" : "png";
    try {
      await saveFileAs(`eureka-image-${id}.${extension}`, async () => {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok || Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw Error();
        return response.blob();
      }, () => alive.current);
    } catch { if (alive.current) setSaveError(true); }
    finally { if (alive.current) setSaving(false); }
  }
  return <SettingsCard className="my-3 max-w-[560px] p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium">{t("imageGeneration.title")}</span>{item && <Button size="sm" variant="outline" disabled={saving} onClick={() => void save()}>{t(saving ? "imageGeneration.saving" : "imageGeneration.save")}</Button>}</div>
    {error ? <p role="alert" className="text-xs text-[var(--text-muted)]">{t("imageGeneration.unavailable")}</p> : item ? <>
      <ImagePreview src={endpoint} alt={item.prompt} className="w-full">
        {/* Private artifacts must use the authenticated endpoint directly, without an image optimizer cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={endpoint} alt={item.prompt} loading="lazy" className="max-h-[420px] w-full rounded-[var(--radius-control)] object-contain" onError={() => setError(true)}/>
      </ImagePreview>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-[var(--text-muted)]">{item.prompt}</p>
      <p className="mt-2 break-words text-xs text-[var(--text-dim)]">{item.provider} · {item.modelId}{item.usage && (item.usage.cost.total > 0 || item.usage.cost.totalFromProvider) ? ` · ${t(item.usage.cost.totalFromProvider ? "imageGeneration.reported" : "imageGeneration.estimated")} $${item.usage.cost.total.toFixed(4)}` : ` · ${t("imageGeneration.unknownCost")}`}</p>
    </> : <p role="status" className="text-xs text-[var(--text-muted)]">{t("imageGeneration.loading")}</p>}
    {saveError && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{t("imageGeneration.saveError")}</p>}
  </SettingsCard>;
}
