"use client";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatAutomationSnapshot } from "@/hooks/useChatAutomations";
import type { ClarificationGroup } from "@/lib/clarification";
import type { UserInputResponse } from "@/lib/user-input";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

/** Only the exceptional authorization prompt is rendered, never a run panel. */
export function AutomationChatFilePicker({ snapshot, group, onAction }: { snapshot: ChatAutomationSnapshot; group: ClarificationGroup;
  onAction: (type: "answer_clarification" | "retry_clarification" | "cancel_clarification", groupId: string, responses?: UserInputResponse[]) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = snapshot.invocation.interaction;
  const field = snapshot.detail?.ui.fields.find(field => field.id === request?.fieldId);
  async function select() {
    if (busy || !field || !request) return;
    setBusy(true); setError("");
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("请在 Eureka 桌面程序中选择本地文件。");
      let selected: string;
      if (field.type === "directory") selected = await invoke<string | null>("desktop_select_directory", { cwd: null }) ?? "";
      else { const files = await invoke<string[]>("desktop_select_attachments", { cwd: null }); if (files.length > 1) throw new Error("请选择一个文件。"); selected = files[0] ?? ""; }
      if (!selected) return;
      const response = await fetch("/api/automation/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ action: "select-file", sessionId: snapshot.invocation.sessionId, invocationId: snapshot.invocation.id, groupId: group.id,
          ownerKey: snapshot.ownerKey, runtimeId: snapshot.runtimeId, path: selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "文件授权未完成。");
      const continued = await onAction("answer_clarification", group.id, [{ questionId: group.questions[0].id, optionIds: ["selected"] }]);
      if (!continued) setError("选择已保存，请继续原任务。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "文件选择未完成。"); }
    finally { setBusy(false); }
  }
  return <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-4">
    <p className="mb-3 text-sm font-semibold">{snapshot.detail?.manifest.displayName} · {field?.label ?? "选择文件"}</p>
    <p className="mb-3 text-xs text-[var(--text-muted)]">{request?.access === "readwrite" ? "允许应用读取和修改所选路径。" : "允许应用读取所选路径。"}{request?.persist ? "保存为默认配置。" : "仅用于本次任务。"}</p>
    {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void onAction("cancel_clarification", group.id)}>取消</Button>
      <Button size="sm" disabled={busy} onClick={() => void select()}>{busy ? "处理中…" : request?.selected ? "重新选择并继续" : "选择并继续"}</Button></div>
  </div>;
}
