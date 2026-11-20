"use client";
import { useEffect, useRef, useState } from "react";
import type { AutomationAppDetail } from "@/features/automation/shared/automation-app";
import { appCredentialCommand, appCredentialSpecs, type AppCredentialSpec } from "@/features/automation/runtime/automation-app-secrets";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Credential({ spec, owner, appId, disabled }: { spec: AppCredentialSpec; owner: string; appId: string; disabled: boolean }) {
  const { t } = useI18n();
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), working = useRef(false);
  useEffect(() => {
    alive.current = true;
    void appCredentialCommand(owner, appId, "status", spec).then(result => { if (alive.current) { setConfigured(result.configured); setLoaded(true); } }).catch(() => { if (alive.current) setError(t("automationUi.credentialUnavailable")); });
    const element = input.current;
    return () => { alive.current = false; if (element) element.value = ""; };
  }, [owner, appId, spec, t]);
  async function change(action: "set" | "delete") {
    if (working.current || disabled || !loaded) return;
    working.current = true; setBusy(true); setError("");
    try { const result = await appCredentialCommand(owner, appId, action, spec, action === "set" ? input.current?.value : undefined); if (alive.current) setConfigured(result.configured); }
    catch { if (alive.current) setError(t("automationUi.credentialFailed")); }
    finally { if (input.current) input.current.value = ""; working.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="space-y-2 rounded-md border border-[var(--border)] p-3">
    <label htmlFor={`credential-${spec.credentialId}`} className="text-sm font-medium">{spec.credentialId} · {spec.kind} · {t(configured ? "automationUi.credentialConfigured" : "automationUi.credentialMissing")}</label>
    <p className="break-all text-xs text-[var(--text-muted)]">{spec.scopes.map(scope => `${scope.method} ${scope.url}`).join(" · ")}</p>
    <div className="flex items-center gap-2"><Input ref={input} id={`credential-${spec.credentialId}`} type="password" autoComplete="new-password" maxLength={16384} disabled={disabled || busy || !loaded} placeholder={t("automationUi.credentialInput")} /><Button type="button" size="sm" disabled={disabled || busy || !loaded} onClick={() => void change("set")}>{t("automationUi.save")}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || busy || !configured} onClick={() => void change("delete")}>{t("automationUi.revoke")}</Button></div>
    {error && <p role="alert" className="text-sm text-[var(--danger,#b42318)]">{error}</p>}
  </div>;
}
export function AutomationAppCredentials({ detail, owner, disabled }: { detail: AutomationAppDetail; owner: string; disabled: boolean }) {
  const { t } = useI18n();
  const [specs] = useState(() => appCredentialSpecs(detail));
  if (!specs.length) return null;
  return <section className="mt-4 space-y-3" aria-label={t("automationUi.credentials")}><h3 className="text-sm font-medium">{t("automationUi.credentials")}</h3><p className="text-xs text-[var(--text-muted)]">{t("automationUi.credentialHint")}</p>{specs.map(spec => <Credential key={spec.credentialId} spec={spec} owner={owner} appId={detail.install.id} disabled={disabled} />)}</section>;
}
