"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import type { AutomationAppEditValues, AutomationAppIndex } from "@/lib/automation-app";
import type { PublicationDraft, PublicationView } from "@/lib/automation-publication";
import { loadPublicationView } from "@/lib/automation-publication-client";
import { useI18n } from "@/hooks/useI18n";
import { AutomationAppMetadataFields } from "./AutomationAppMetadataFields";
import { AutomationPublicationDocument } from "./AutomationPublicationDocument";
import { NotificationNotice } from "./Notifications";
import { notify } from "@/lib/notification-store";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

interface Props {
  appId: string; index: AutomationAppIndex; active: boolean; initialView: PublicationView | null; onClose: () => void;
}

const publicationActionClassName = "border border-transparent bg-black text-white hover:bg-black hover:opacity-100";

/** A connection in progress never mounts a dialog or its backdrop. */
export function AutomationAppPublish({ initialView, ...props }: Props) {
  return initialView ? <PublicationDialog {...props} initialView={initialView} /> : null;
}

function PublicationDialog({ appId, index, active, initialView, onClose }: Omit<Props, "initialView"> & { initialView: PublicationView }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState(initialView), [draft, setDraft] = useState(initialView.draft);
  const [tags, setTags] = useState(initialView.draft.tags.join(", "));
  const [busy, setBusy] = useState(false), [readingIcon, setReadingIcon] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [allowLive, setAllowLive] = useState(false);
  const [tab, setTab] = useState<"basic" | "quickStart" | "readme">("basic");
  const alive = useRef(true), operation = useRef(false), controller = useRef<AbortController | null>(null);
  const endpoint = "/api/automation/apps/" + encodeURIComponent(appId) + "/publication";
  const identity = { ownerKey: index.ownerKey, runtimeId: index.runtimeId };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  function accept(data: PublicationView) {
    if (data.ownerKey !== index.ownerKey || data.runtimeId !== index.runtimeId) throw new Error(t("automationUi.identityChanged"));
    if (alive.current) { setView(data); setDraft(data.draft); setTags(data.draft.tags.join(", ")); setAllowLive(false); }
  }
  async function act(action: string) {
    if (operation.current || busy || readingIcon || !active) return;
    operation.current = true; setBusy(true);
    setGenerating(action === "generate");
    const abort = new AbortController(); controller.current = abort;
    try {
      if (action === "refresh") {
        const data = await loadPublicationView(endpoint + "?" + new URLSearchParams(identity));
        if (alive.current) accept(data); return;
      }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, action, draft, digest: view.digest, locale, allowLiveMetadata: allowLive }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!alive.current) return; accept(data); notify({ type: "success", message: t("publication.done." + action) });
    } catch (e) {
      if (alive.current) {
        notify({ type: "error", message: e instanceof Error && e.name !== "TimeoutError" ? e.message : t("publication.failed") });
        try {
          const data = await loadPublicationView(endpoint + "?" + new URLSearchParams(identity));
          if (alive.current) accept(data);
        } catch { /* Keep the original failure visible; recovery remains explicit. */ }
      }
    } finally { operation.current = false; if (alive.current) { setBusy(false); setGenerating(false); } }
  }
  const dirty = JSON.stringify(view.draft) !== JSON.stringify(draft);
  const locked = busy || readingIcon || !active || view.retryPending;
  const remote = view.remote, status = remote?.pending_status ?? remote?.status;
  const canEdit = !status || ["draft", "rejected", "published", "offline"].includes(status);
  const metadata: AutomationAppEditValues = { displayName: draft.name, description: draft.description, categoryId: draft.categoryId, tags: draft.tags, icon: draft.icon ?? null };
  function change<K extends keyof PublicationDraft>(key: K, value: PublicationDraft[K]) { setDraft(old => ({ ...old, [key]: value })); }
  function changeMetadata(patch: Partial<AutomationAppEditValues>) {
    setDraft(old => ({
      ...old,
      ...(patch.displayName !== undefined ? { name: patch.displayName } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...("icon" in patch ? { icon: patch.icon ?? undefined } : {}),
    }));
  }
  const star = <span className="text-[var(--danger)]" aria-hidden="true">*</span>;
  const needsVersion = !view.canSave && !view.retryPending && remote?.published_version === view.version && !remote.pending_version;
  return <Dialog open disablePointerDismissal onOpenChange={open => { if (!open && !busy && !readingIcon) onClose(); }}><DialogContent className="h-[min(720px,85dvh)]">
    <DialogHeader><DialogTitle>{t("publication.dialogTitle")}</DialogTitle></DialogHeader>
    <NotificationNotice message={view.retryPending ? t("publication.pending") : null} type="warning" action={{ label: t("publication.retry"), onClick: () => { void act("retry"); } }} />
    <NotificationNotice message={remote?.review_comment} type="warning" />
    <NotificationNotice message={needsVersion ? t("publication.bumpVersion") : null} type="info" />
    <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <TabsList><TabsTrigger value="basic" disabled={readingIcon}>{t("publication.basicInfo")}</TabsTrigger><TabsTrigger value="quickStart" disabled={readingIcon}>{t("publication.quickStart")}</TabsTrigger><TabsTrigger value="readme" disabled={readingIcon}>{t("publication.readme")}</TabsTrigger></TabsList>
        <Button type="button" size="sm" variant="outline" className="ml-auto min-w-28 gap-1.5" disabled={locked || !canEdit} aria-busy={generating} onClick={() => void act("generate")}>{generating ? <LoaderCircleIcon size={14} className="animate-spin" aria-hidden="true" /> : <SparklesIcon size={14} aria-hidden="true" />}{t(generating ? "publication.generating" : "publication.generate")}</Button>
      </div>
      <DialogBody className={tab === "basic" ? undefined : "flex flex-col overflow-hidden"}>
        <TabsContent value="basic"><FieldGroup>
          <AutomationAppMetadataFields values={metadata} tags={tags} categories={view.context.categories} disabled={locked || !canEdit} idPrefix="app-publish" layout="publish" iconMaxBytes={view.context.uploads.icon_max_bytes} onChange={changeMetadata} onTagsChange={value => { setTags(value); change("tags", value.split(/[,，]/)); }} onError={message => { if (message) notify({ type: "error", message }); }} onReadingIcon={setReadingIcon} nameAside={<Field><FieldLabel htmlFor="app-publish-code">{t("publication.code")}{star}</FieldLabel><Input id="app-publish-code" required minLength={3} maxLength={50} value={draft.code} disabled={locked || !canEdit || Boolean(remote)} onChange={e => change("code", e.target.value)} /></Field>} nameEnd={<Field><FieldLabel htmlFor="app-publish-version">{t("automationUi.version")}{star}</FieldLabel><Input id="app-publish-version" value={view.version} required readOnly /></Field>} />
          {remote?.published_version && <Field><FieldLabel htmlFor="app-publish-changelog">{t("publication.changelog")}{view.version !== remote.published_version && star}</FieldLabel><Textarea id="app-publish-changelog" required={view.version !== remote.published_version} rows={3} maxLength={5000} value={draft.changelog} disabled={locked || !canEdit} onChange={e => change("changelog", e.target.value)} /></Field>}
          {(status || view.retryPending) && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{status ? t("publication.status." + status) : ""}</span><div className="flex gap-2">{view.retryPending && <Button type="button" size="sm" variant="outline" disabled={busy || !active} onClick={() => void act("retry")}>{t("publication.retry")}</Button>}<Button type="button" size="sm" variant="ghost" disabled={busy || readingIcon || !active} onClick={() => void act("refresh")}>{t("publication.refresh")}</Button></div></div>}
          {remote?.is_listed && canEdit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowLive} disabled={locked} onChange={e => setAllowLive(e.target.checked)} /><span>{t("publication.liveMetadata")}</span></label>}
        </FieldGroup></TabsContent>
        <TabsContent value="quickStart" className="flex min-h-0 flex-1 flex-col"><AutomationPublicationDocument id="app-publish-quickStart" title={t("publication.quickStart")} value={draft.quickStart} maxLength={100000} disabled={locked || !canEdit} onChange={value => change("quickStart", value)} /></TabsContent>
        <TabsContent value="readme" className="flex min-h-0 flex-1 flex-col"><AutomationPublicationDocument id="app-publish-readme" title={t("publication.readme")} value={draft.readme} maxLength={200000} disabled={locked || !canEdit} onChange={value => change("readme", value)} /></TabsContent>
      </DialogBody>
    </Tabs>
    <DialogFooter className="flex-wrap items-center [&>button]:box-border [&>button]:h-10">
      <Button variant="outline" disabled={busy || readingIcon} onClick={onClose}>{t("automationUi.cancel")}</Button>
      <Button variant="outline" disabled={locked || !dirty || !canEdit} onClick={() => void act("draft")}>{t("publication.localDraft")}</Button>
      <Button className={publicationActionClassName} disabled={locked || !canEdit || !(view.canSave || allowLive && view.context.actions.update && view.context.actions.create)} onClick={() => void act("save")}>{t("publication.save")}</Button>
      {view.canSubmit && <Button className={publicationActionClassName} disabled={locked || dirty} onClick={() => void act("submit-review")}>{t("publication.submit")}</Button>}
      {view.canPublish && <Button className={publicationActionClassName} disabled={locked || dirty} onClick={() => void act("publish")}>{t("publication.publish")}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
