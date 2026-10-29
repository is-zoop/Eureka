"use client";

import { ExtensionErrorText } from "./ExtensionNotice";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
type Summary = { name: string; state: string; skills: string[]; servers: Array<{ name: string; url: string }>; error?: string; capabilities?: { requestUserInput?: boolean }; composer?: { selectionMode: "once" | "persistent" } };
export function OrganizationPluginSummary({ itemId, cwd, sessionId, revision }: { itemId: string; cwd: string; sessionId?: string | null; revision?: unknown }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/organization-extensions/${itemId}/installation?${new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) })}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setSummary(payload.project?.find((entry: { plugin?: Summary }) => entry.plugin)?.plugin ?? payload.global?.find((entry: { plugin?: Summary }) => entry.plugin)?.plugin ?? null);
      } catch { /* Keep the last known status during reconnects. */ }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [cwd, itemId, revision, sessionId]);
  if (!summary) return null;
  return <section className="mb-4 space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] p-4 text-xs"><p className="font-medium">{t("extensions.pluginComponents")} · {t(`extensions.pluginState.${summary.state}`)}</p>{summary.skills.map((skill) => <p key={skill}>{t("extensions.skills")} · {skill}</p>)}{summary.capabilities?.requestUserInput && <p>{t("extensions.pluginUserInput")}</p>}{summary.composer?.selectionMode === "persistent" && <p>{t("extensions.pluginPersistent")}</p>}{summary.servers.map((server) => <p key={server.name} className="break-all">{t("extensions.mcp")} · {server.name} · {server.url}</p>)}{summary.error ? <div className="text-red-600"><ExtensionErrorText error={summary.error} /></div> : null}</section>;
}
