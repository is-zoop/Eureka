"use client";
import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { AutomationAppEditValues } from "@/lib/automation-app";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldLabel } from "./ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** Shared application metadata controls, with a compact publication grid. */
export function AutomationAppMetadataFields({ values, tags, categories, disabled, idPrefix, iconSource = "", iconMaxBytes = 2 * 1024 * 1024, layout = "edit", nameAside, nameEnd, onChange, onTagsChange, onError, onReadingIcon }: {
  values: AutomationAppEditValues; tags: string; categories?: { id: number; name: string }[]; disabled: boolean; idPrefix: string;
  iconSource?: string; iconMaxBytes?: number; layout?: "edit" | "publish"; nameAside?: ReactNode; nameEnd?: ReactNode;
  onChange: (patch: Partial<AutomationAppEditValues>) => void;
  onTagsChange: (value: string) => void; onError: (message: string) => void; onReadingIcon: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null), alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function chooseIcon(selected?: File) {
    if (!selected) return;
    if (selected.size > iconMaxBytes || !["image/png", "image/jpeg", "image/webp"].includes(selected.type)) { onError(t("publication.iconError")); return; }
    const token = ++generation.current; onReadingIcon(true); onError("");
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(selected); });
      if (alive.current && token === generation.current) onChange({ icon: { name: selected.name, type: selected.type, data } });
    } catch { if (alive.current) onError(t("publication.iconError")); }
    finally { if (alive.current && token === generation.current) onReadingIcon(false); }
  }
  const publishing = layout === "publish";
  const id = (field: string) => idPrefix + "-" + field;
  const star = <span className="text-[var(--danger)]" aria-hidden="true">*</span>;
  const preview = values.icon ? "data:" + values.icon.type + ";base64," + values.icon.data : values.icon === undefined ? iconSource : "";
  const selectedCategory = categories?.find(c => c.id === values.categoryId);
  const nameField = <Field>
    <FieldLabel htmlFor={id("name")}>{t("automationUi.appName")}{star}</FieldLabel>
    <div className="relative"><Input id={id("name")} autoFocus required maxLength={100} className={publishing ? "pr-20" : undefined} value={values.displayName} disabled={disabled} onChange={e => onChange({ displayName: e.target.value })} />{publishing && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-dim)]">{values.displayName.length} / 100</span>}</div>
  </Field>;
  const iconField = <Field>
    <FieldLabel htmlFor={id("icon")}>{t("appEdit.icon")}</FieldLabel>
    <div className="group/app-icon relative h-10 w-10">
      <Button type="button" id={id("icon")} variant="outline" size="icon" className="h-10 w-10 overflow-hidden p-0 focus-visible:outline-[var(--border)]" disabled={disabled} aria-label={t("appEdit.icon")} onClick={() => file.current?.click()}>
        {preview ? <Image src={preview} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 object-cover" /> : <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center"><PlusIcon size={18} /></span>}
      </Button>
      {preview && <Button type="button" variant="ghost" size="icon" className="pointer-events-none absolute inset-y-0 left-0 h-10 w-10 border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] text-[var(--danger)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--bg-panel)_88%,transparent)] focus-visible:outline-[var(--danger)] group-hover/app-icon:pointer-events-auto group-hover/app-icon:opacity-100 group-focus-within/app-icon:pointer-events-auto group-focus-within/app-icon:opacity-100" disabled={disabled} aria-label={t("appEdit.removeIcon")} onClick={() => onChange({ icon: null })}><Trash2Icon size={16} /></Button>}
      <input ref={file} type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={e => { void chooseIcon(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  </Field>;
  const categoryField = <Field>
    <FieldLabel htmlFor={id("category")}>{t("publication.category")}{publishing && star}</FieldLabel>
    <Select value={values.categoryId === null ? "" : String(values.categoryId)} onValueChange={value => onChange({ categoryId: value ? Number(value) : null })} required={publishing} disabled={disabled || !categories}><SelectTrigger id={id("category")} aria-required={publishing}><SelectValue>{selectedCategory?.name ?? t("publication.selectCategory")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">{t("publication.selectCategory")}</SelectItem>{categories?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select>
  </Field>;
  const tagsField = <Field><FieldLabel htmlFor={id("tags")}>{t("extensions.capabilityTags")}</FieldLabel><Input id={id("tags")} value={tags} disabled={disabled} onChange={e => onTagsChange(e.target.value)} /></Field>;
  return <>
    {publishing ? <div className="grid gap-6 sm:grid-cols-2">
      {nameField}
      <div className={"grid min-w-0 gap-6 " + (nameEnd ? "grid-cols-[minmax(0,1fr)_88px]" : "grid-cols-1")}>{nameAside}{nameEnd}</div>
      <div className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] gap-6">{iconField}{categoryField}</div>
      {tagsField}
    </div> : <>{nameField}<div className="grid gap-6 sm:grid-cols-[auto_1fr]">{iconField}{categoryField}</div>{tagsField}</>}
    <Field>
      <FieldLabel htmlFor={id("description")}>{t("appEdit.description")}{publishing && star}</FieldLabel>
      <div className="relative"><Textarea id={id("description")} required={publishing} rows={4} maxLength={300} className={publishing ? "pb-8" : undefined} value={values.description} disabled={disabled} onChange={e => onChange({ description: e.target.value })} />{publishing && <span className="pointer-events-none absolute bottom-3 right-3 font-mono text-xs text-[var(--text-dim)]">{values.description.length} / 300</span>}</div>
    </Field>
  </>;
}
