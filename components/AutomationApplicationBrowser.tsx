"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState } from "react";
import type { AutomationAppDetail, AutomationAppIndex } from "@/lib/automation-app";
import type { AppRunRecord } from "@/lib/automation-app-run";
import type { AppWebGrant } from "@/lib/automation-app-browser";
import { accountCommand, DEFAULT_BROWSER_ID, type WebsiteAccount } from "@/lib/automation-accounts";
import { isDesktopBrowserHost } from "@/lib/native-browser";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import styles from "./AutomationApplication.module.css";

export function AutomationApplicationBrowser({ detail, index, run, running, active,taskId,view="all" }: { detail: AutomationAppDetail; index: AutomationAppIndex; run: AppRunRecord | null; running: boolean; active: boolean;taskId?:string;view?:"all"|"settings"|"requests" }) {
  const { t } = useI18n();
  const translation = useRef(t); translation.current = t;
  const [environments, setEnvironments] = useState<Record<string,string>>({}), [grants, setGrants] = useState<AppWebGrant[]>([]), [accounts, setAccounts] = useState<WebsiteAccount[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [chosen, setChosen] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false), [accountsLoading, setAccountsLoading] = useState(false), [saved, setSaved] = useState(false);
  const approvalRef=useRef<HTMLDivElement>(null);
  useEffect(() => {
    const changed = () => setRefresh(n => n + 1);
    window.addEventListener("eureka:browser-environments-changed", changed);
    return () => window.removeEventListener("eureka:browser-environments-changed", changed);
  }, []);
  const sites = detail.manifest.automation.browser?.sites ?? [], approval = run?.status==="waiting-user"&&run.runtimeId===index.runtimeId ? run.browserApproval : undefined, endpoint = `/api/automation/apps/${detail.install.id}/browser`;
  useEffect(() => { setChosen(approval ? [approval.requestedOperation] : []); }, [approval?.id]);
  useEffect(() => {
    if (!active || !sites.length || view === "requests") return;
    const controller = new AbortController(); setError(""); setLoaded(false);
    void fetch(`${endpoint}?${new URLSearchParams({ownerKey:index.ownerKey,runtimeId:index.runtimeId,...(taskId?{taskId}:{})})}`, { cache:"no-store", signal:controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) { setEnvironments(data.settings.environments); setGrants(data.grants.grants); setLoaded(true); }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : translation.current("automationUi.readWebGrants")); });
    const desktop = isDesktopBrowserHost(); setAccountsLoading(desktop);
    if (desktop) void accountCommand(index.ownerKey,"list").then(data=>{if(!controller.signal.aborted)setAccounts(data.accounts);}).catch(()=>{if(!controller.signal.aborted)setError(translation.current("automationUi.readEnvironments"));}).finally(()=>{if(!controller.signal.aborted)setAccountsLoading(false);});
    return () => controller.abort();
  }, [active, endpoint, index.ownerKey, index.runtimeId, refresh, approval?.id, view, taskId]);
  async function post(mode:string,extra:Record<string,unknown>) {
    if(busy||!active||(mode==="settings"&&(!loaded||accountsLoading||running)))return; setBusy(true);setError("");
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,ownerKey:index.ownerKey,runtimeId:index.runtimeId,taskId,revision:detail.install.revision,runId:run?.id,...extra}),signal:AbortSignal.timeout(30000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);setRefresh(n=>n+1);if(mode==="settings")setSaved(true);
    }catch(e){setError(e instanceof Error?e.message:t("automationUi.incomplete"));}finally{setBusy(false);}
  }
  if(!sites.length || (view === "requests" && !approval && !error))return null;
  return <section aria-label={t("automationUi.webEnvironment")}>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {view!=="settings"&&approval&&<div ref={approvalRef} className={styles.question} aria-label={t("automationUi.firstWebGrant")}>
      <h3>{t("automationUi.confirmWebScope")}</h3><p>{detail.manifest.displayName} {t("automationUi.runVersion", { version: approval.version })} · {approval.siteLabel}</p>
      <p>{t("automationUi.siteLabel")}{approval.origin}<br/>{t("automationUi.accountLabel")}<strong>{approval.account}</strong><br/>{t("automationUi.environmentLabel")}{approval.environment}</p>
      <p className={styles.muted}>{t("automationUi.grantExplanation")}</p>
      {approval.target&&<p>{t("automationUi.targetLabel")}{approval.target}</p>}{approval.value!==undefined&&<p>{t("automationUi.valueLabel")}{JSON.stringify(approval.value)}</p>}
      {approval.operations.map(op=><label key={op.id} className={styles.check}><input type="checkbox" disabled={busy||op.id===approval.requestedOperation} checked={chosen.includes(op.id)} onChange={e=>setChosen(previous=>e.target.checked?[...previous,op.id]:previous.filter(id=>id!==op.id))}/><span><strong>{op.label}</strong>：{op.description}{op.id===approval.requestedOperation?t("automationUi.currentRequest"):""}</span></label>)}
      <div className={styles.actions}><Button disabled={busy||!active} onClick={()=>void post("approve",{approvalId:approval.id,operationIds:chosen})}>{t("automationUi.approveScope")}</Button><Button variant="outline" disabled={busy||!active} onClick={()=>void post("deny",{})}>{t("automationUi.denyStop")}</Button></div>
    </div>}
    {view!=="requests"&&<div className={styles.browserSettings}>
      <div className={styles.browserSites}>
      {sites.map(site=>{
        const available=accounts.filter(a=>a.id!==DEFAULT_BROWSER_ID&&!a.deleted&&a.origin===new URL(site.startUrl).origin);
        const selected=environments[site.id]??DEFAULT_BROWSER_ID;
        const missing=selected!==DEFAULT_BROWSER_ID&&selected!=="temporary"&&!available.some(a=>a.id===selected);
        const items = [...(missing ? [{ value: selected, label: accountsLoading ? t("automationUi.loadingEnvironments") : t("automationUi.missingEnvironment"), disabled: true }] : []), { value: DEFAULT_BROWSER_ID, label: t("automationUi.defaultBrowser"), disabled: false }, { value: "temporary", label: t("automationUi.temporaryBrowser"), disabled: false }, ...available.map(a => ({ value: a.id, label: a.name, disabled: false }))];
        return <div key={site.id} className={styles.field}><label htmlFor={`browser-environment-${site.id}`}>{site.label}<span className={styles.browserHost}>{new URL(site.startUrl).host}</span></label><Select disabled={busy||running||!active||!loaded||accountsLoading} value={selected} items={items} onValueChange={value=>{if(value===null)return;setSaved(false);setEnvironments(old=>({...old,[site.id]:value}));}}>
          <SelectTrigger id={`browser-environment-${site.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>{items.map(item=><SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent>
        </Select></div>;
      })}
      </div>
      <div><Button size="sm" disabled={busy||running||!active||!loaded||accountsLoading||saved} onClick={()=>void post("settings",{environments})}>{busy?t("automationUi.processing"):saved?t("automationUi.saved"):t("automationUi.save")}</Button></div>
      {grants.some(g=>!g.revokedAt)&&<Collapsible className={styles.browserGrants}><CollapsibleTrigger render={<Button variant="ghost" size="sm" className="gap-1.5"/>}><ChevronDownIcon size={13}/>{t("automationUi.webGrants", { count: grants.filter(g=>!g.revokedAt).length })}</CollapsibleTrigger><CollapsibleContent>
        {grants.filter(g=>!g.revokedAt).map(g=><div key={g.id} className={styles.heading}><p>{g.accountLabel} · {g.origin}<br/><small>{t("automationUi.operation")} {g.operationId} {t("automationUi.codeLabel")} {g.digest.slice(0,12)} · {g.environment}</small></p><Button variant="outline" size="sm" disabled={busy||!active} onClick={()=>void post("revoke",{grantId:g.id})}>{t("automationUi.revoke")}</Button></div>)}
      </CollapsibleContent></Collapsible>}
    </div>}
  </section>;
}
