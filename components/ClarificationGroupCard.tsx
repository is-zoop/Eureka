"use client";
import { useState } from "react";
import type { ClarificationGroup } from "@/lib/clarification";
import type { UserInputResponse } from "@/lib/user-input";
import { useI18n } from "@/hooks/useI18n";
import { UserInputCard } from "./UserInputCard";
import { Button } from "./ui/button";

export function ClarificationGroupCard({ group, onAction, history = false }: {
  group: ClarificationGroup; history?: boolean;
  onAction?: (type: "answer_clarification" | "retry_clarification" | "cancel_clarification", groupId: string, responses?: UserInputResponse[]) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const action = async (type: "answer_clarification" | "retry_clarification" | "cancel_clarification", responses?: UserInputResponse[]) => {
    if (!onAction || busy) return false;
    setBusy(true);
    try { return await onAction(type, group.id, responses); } finally { setBusy(false); }
  };
  const retry = group.status === "answered" && ["ready", "failed"].includes(group.continuation);
  return <div data-clarification-group={group.id}>
    {group.source === "plugin" && <p className="text-xs text-[var(--text-muted)]">{group.task.plugins.map((p) => p.name).join(" · ")}</p>}
    <UserInputCard questions={group.questions} readOnly={history || group.status !== "pending"} onAnswer={(_, responses) => action("answer_clarification", responses)} />
    {group.status === "cancelled" && <p className="text-xs text-[var(--text-muted)]">{t("clarification.cancelled")}</p>}
    {group.error && <p role="alert" className="my-2 text-xs text-red-600">{group.error}</p>}
    {!history && group.status !== "cancelled" && group.continuation !== "completed" && <div className="mb-3 flex justify-end gap-2">
      {retry && <Button variant="outline" disabled={busy} onClick={() => void action("retry_clarification")}>{t("clarification.retry")}</Button>}
      {group.continuation !== "running" && <Button variant="outline" disabled={busy} onClick={() => void action("cancel_clarification")}>{t("clarification.cancel")}</Button>}
    </div>}
  </div>;
}
