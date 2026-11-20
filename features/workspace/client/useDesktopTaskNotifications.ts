"use client";

import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../../../hooks/useI18n";
import { AgentCommandError, DESKTOP_REPLY_SENT_EVENT, sendAgentCommand } from "@/features/chat/shared/agent-client";
import type { SessionCompletion } from "@/features/sessions/server/session-completions";

interface DesktopCompletionReply {
  requestId: string;
  sessionId: string;
  message: string;
}

async function sendReply({ requestId, sessionId, message }: DesktopCompletionReply) {
  let ok: boolean | null;
  try {
    await sendAgentCommand(sessionId, { type: "prompt", message });
    ok = true;
  } catch (error) {
    ok = error instanceof AgentCommandError ? false : null;
  }
  if (ok) window.dispatchEvent(new CustomEvent(DESKTOP_REPLY_SENT_EVENT, { detail: sessionId }));
  await invoke("desktop_completion_reply_result", { requestId, ok });
}

export function useDesktopTaskNotifications() {
  const { t, locale } = useI18n();
  const labels = useRef({ t, locale });
  useEffect(() => { labels.current = { t, locale }; }, [t, locale]);

  useEffect(() => {
    if (!isTauri()) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;

    function handleCompletion(event: MessageEvent<string>) {
      let completion: SessionCompletion;
      try {
        completion = JSON.parse(event.data) as SessionCompletion;
      } catch {
        return;
      }
      if (typeof completion?.sessionId !== "string" || typeof completion.title !== "string" || typeof completion.summary !== "string") return;
      const { t, locale } = labels.current;
      void invoke("desktop_task_completed", {
        notification: {
          sessionId: completion.sessionId,
          title: completion.title || t("i18n.taskFinished"),
          summary: completion.summary || t("desktopCompletion.noSummary"),
          closeLabel: t("chat.close"),
          replyPlaceholder: t("desktopCompletion.replyPlaceholder"),
          sendLabel: t("chat.send"),
          sendingLabel: t("desktopCompletion.sending"),
          sentLabel: t("desktopCompletion.sent"),
          failureLabel: t("desktopCompletion.replyFailed"),
          unconfirmedLabel: t("desktopCompletion.replyUnconfirmed"),
          locale,
        },
      }).catch(() => {
        // A development webview can briefly run newer web code than its host.
      });
    }

    void listen<DesktopCompletionReply>("desktop-completion-reply", ({ payload }) => {
      if (!disposed) void sendReply(payload).catch(() => {});
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      const stream = new EventSource("/api/agent/running/events");
      stream.addEventListener("completion", handleCompletion);
      cleanup = () => {
        stream.close();
        unlisten();
      };
    }).catch(() => {});

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
}
