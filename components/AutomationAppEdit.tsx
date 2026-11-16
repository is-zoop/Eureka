"use client";
import { useEffect, useRef, useState } from "react";
import type { AutomationAppDetail, AutomationAppEditValues, AutomationAppEditView, AutomationAppIndex } from "@/lib/automation-app";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { FieldError, FieldGroup } from "./ui/field";
import { AutomationAppMetadataFields } from "./AutomationAppMetadataFields";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export function AutomationAppEdit({ detail, index, active, onSaved, onClose }: {
  detail: AutomationAppDetail; index: AutomationAppIndex; active: boolean;
  onSaved: (detail: AutomationAppDetail) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const initial = detail.install.presentation;
  const [values, setValues] = useState<AutomationAppEditValues>({ displayName: detail.manifest.displayName, description: detail.manifest.description.slice(0, 300), categoryId: initial?.categoryId ?? null, tags: initial?.tags ?? [] });
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [view, setView] = useState<AutomationAppEditView | null>(null), [busy, setBusy] = useState(false), [readingIcon, setReadingIcon] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), touched = useRef(false), saving = useRef(false);
  const endpoint = `/api/automation/apps/${encodeURIComponent(detail.install.id)}/metadata`;
  const identity = { ownerKey: index.ownerKey, runtimeId: index.runtimeId };
  const translation = useRef(t); translation.current = t;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`${endpoint}?${new URLSearchParams(identity)}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.ownerKey !== index.ownerKey || data.runtimeId !== index.runtimeId) throw new Error(translation.current("automationUi.identityChanged"));
      if (!abort.signal.aborted) { setView(data); if (!touched.current) { setValues({ displayName: data.displayName, description: data.description, categoryId: data.categoryId, tags: data.tags, icon: data.icon }); setTags(data.tags.join(", ")); } }
    }).catch(e => { if (!abort.signal.aborted && alive.current) setError(e instanceof Error ? e.message : translation.current("automationUi.retryOperation")); });
    return () => abort.abort();
    // This editor is keyed by application and login identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.install.id, index.ownerKey, index.runtimeId]);
  async function save() {
    if (saving.current || !view || !active || readingIcon) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, revision: view.revision, values: { ...values, tags: tags.split(/[,，]/) } }), signal: AbortSignal.timeout(45000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.ownerKey !== index.ownerKey || data.runtimeId !== index.runtimeId) throw new Error(t("automationUi.identityChanged"));
      if (alive.current) { onSaved(data); onClose(); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t("automationUi.retryOperation")); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const disabled = busy || readingIcon || !active;
  const iconSource = initial?.icon ? `/api/automation/apps/${detail.install.id}/icon?${new URLSearchParams({ ...identity, v: initial.icon.digest })}` : "";
  return <Dialog open onOpenChange={open => { if (!open && !disabled) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t("automationUi.editApp")}</DialogTitle></DialogHeader>
    <DialogBody><form id="automation-edit-app" onSubmit={event => { event.preventDefault(); void save(); }}>
      <FieldGroup>
        <AutomationAppMetadataFields values={values} tags={tags} categories={view?.categories} disabled={disabled} idPrefix="app-edit" iconSource={iconSource} onChange={patch => { touched.current = true; setValues(old => ({ ...old, ...patch })); }} onTagsChange={value => { touched.current = true; setTags(value); }} onError={setError} onReadingIcon={setReadingIcon} />
        <FieldError>{error}</FieldError>
      </FieldGroup>
    </form></DialogBody>
    <DialogFooter><Button variant="outline" disabled={disabled} onClick={onClose}>{t("automationUi.cancel")}</Button><Button type="submit" form="automation-edit-app" disabled={disabled || !view || !values.displayName.trim()}>{t(busy ? "i18n.saving" : "automationUi.save")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
