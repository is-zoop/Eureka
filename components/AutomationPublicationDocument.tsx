"use client";
import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Field, FieldLabel } from "./ui/field";

export function AutomationPublicationDocument({ id, title, value, maxLength, disabled, onChange }: {
  id: string; title: string; value: string; maxLength: number; disabled: boolean; onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState(true);
  return <Field className="min-h-0 flex-1">
    <div className="flex shrink-0 items-center justify-between gap-3">
      <FieldLabel htmlFor={id}>{title}<span className="text-[var(--danger)]" aria-hidden="true">*</span></FieldLabel>
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-pressed={!preview} onClick={() => setPreview(current => !current)}>{t(preview ? "publication.editDocument" : "publication.preview")}</Button>
    </div>
    {preview ? <div id={id} data-publication-document-preview="" role="region" aria-label={title} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-[var(--border)] p-4"><MarkdownBody>{value}</MarkdownBody></div> : <Textarea id={id} required rows={13} className="min-h-0 flex-1 resize-none overflow-y-auto overscroll-contain" maxLength={maxLength} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />}
  </Field>;
}
