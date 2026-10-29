"use client";

import { useI18n } from "@/hooks/useI18n";
import { describeExtensionError } from "@/lib/extension-errors";
import { NotificationNotice } from "./Notifications";
import type { ComponentProps } from "react";

export function ExtensionNotice({ message, type = "error", ...props }: ComponentProps<typeof NotificationNotice>) {
  const { t, locale } = useI18n();
  const feedback = message && locale === "zh-CN" && (type === "error" || type === "warning") ? describeExtensionError(message, t) : { message };
  return <NotificationNotice {...props} {...feedback} type={type} />;
}

export function ExtensionErrorText({ error }: { error: string }) {
  const { t } = useI18n();
  const feedback = describeExtensionError(error, t);
  return <><span>{feedback.message}</span>{feedback.details ? <details className="mt-2 text-xs"><summary className="w-fit cursor-pointer">{t("notifications.details")}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{feedback.details}</pre></details> : null}</>;
}
