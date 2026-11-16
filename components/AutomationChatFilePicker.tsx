"use client";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatAutomationSnapshot } from "@/hooks/useChatAutomations";
import type { ClarificationGroup } from "@/lib/clarification";
import type { UserInputResponse } from "@/lib/user-input";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { useI18n } from "@/hooks/useI18n";

/** Only the exceptional authorization prompt is rendered, never a run panel. */
export function AutomationChatFilePicker({ snapshot, group, onAction }: { snapshot: ChatAutomationSnapshot; group: ClarificationGroup;
  onAction: (type: "answer_clarification" | "retry_clarification" | "cancel_clarification", groupId: string, responses?: UserInputResponse[]) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { t } = useI18n();
  const request = snapshot.invocation.interaction;
  const field = snapshot.detail?.ui.fields.find(field => field.id === request?.fieldId);
  async function select() {
    if (busy || !field || !request) return;
    setBusy(true); setError("");
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error(t("automationUi.filePickerDesktop"));
      let selected: string;
      if (field.type === "directory") selected = await invoke<string | null>("desktop_select_directory", { cwd: null }) ?? "";
      else { const files = await invoke<string[]>("desktop_select_attachments", { cwd: null }); if (files.length > 1) throw new Error(t("automationUi.filePickerOne")); selected = files[0] ?? ""; }
      if (!selected) return;
      const response = await fetch("/api/automation/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ action: "select-file", sessionId: snapshot.invocation.sessionId, invocationId: snapshot.invocation.id, groupId: group.id,
          ownerKey: snapshot.ownerKey, runtimeId: snapshot.runtimeId, path: selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t("automationUi.filePickerAuthorizationFailed"));
      const continued = await onAction("answer_clarification", group.id, [{ questionId: group.questions[0].id, optionIds: ["selected"] }]);
      if (!continued) setError(t("automationUi.filePickerSaved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("automationUi.filePickerFailed")); }
    finally { setBusy(false); }
  }
  return <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4">
    <p className="mb-3 text-sm font-semibold">{snapshot.detail?.manifest.displayName} · {field?.label ?? t("automationUi.filePickerTitle")}</p>
    <p className="mb-3 text-xs text-[var(--text-muted)]">{t(request?.access === "readwrite" ? "automationUi.filePickerReadWrite" : "automationUi.filePickerRead")} {t(request?.persist ? "automationUi.filePickerPersist" : "automationUi.filePickerOnce")}</p>
    {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAction("cancel_clarification", group.id)}>{t("common.cancel")}</Button>
      <Button size="sm" disabled={busy} onClick={() => void select()}>{t(busy ? "automationUi.filePickerBusy" : request?.selected ? "automationUi.filePickerReselect" : "automationUi.filePickerContinue")}</Button></div>
  </div>;
}
