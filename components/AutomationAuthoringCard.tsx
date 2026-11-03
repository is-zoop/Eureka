"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect,useRef,useState } from "react";
import { authorBrowserTarget, type AuthorSnapshot } from "@/lib/automation-authoring-types";
import type { UserInputResponse } from "@/lib/user-input";
import { AutomationApplication } from "./AutomationApplication";
import { AutomationApplicationBrowser } from "./AutomationApplicationBrowser";
import { UserInputCard } from "./UserInputCard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Collapsible,CollapsibleTrigger,CollapsibleContent } from "./ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import styles from "./AutomationApplication.module.css";

export function AutomationAuthoringCard({sessionId,onSaved}:{sessionId:string;onSaved:()=>void}) {
  const { t, locale } = useI18n();
  const translation = useRef(t); translation.current = t;
  const statuses:Record<string,string>={running:t("automationUi.running"),"waiting-user":t("automationUi.waitingHelp"),"waiting-browser":t("automationUi.waitingBrowser"),cancelling:t("automationUi.stopping"),completed:t("automationUi.completed"),failed:t("automationUi.failed"),cancelled:t("automationUi.cancelled"),interrupted:t("automationUi.interrupted")};
  const [snapshot,setSnapshot]=useState<AuthorSnapshot|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);const card=useRef<HTMLElement>(null),saved=useRef(onSaved);saved.current=onSaved;
  const [nameDraft,setNameDraft]=useState<{taskId:string;value:string}|null>(null),[previewOpen,setPreviewOpen]=useState(false);
  const posting=useRef(false),currentSession=useRef(sessionId),currentTask=useRef<string|undefined>(undefined);currentSession.current=sessionId;currentTask.current=snapshot?.task.id;
  useEffect(()=>{setSnapshot(null);setNameDraft(null);setPreviewOpen(false);setError("");let disposed=false,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();async function poll(){try{const response=await fetch(`/api/automation/authoring?${new URLSearchParams({sessionId})}`,{cache:"no-store",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});const data=await response.json();if(!response.ok)throw new Error(data.error);if(disposed)return;setSnapshot(data);setError("");const s=data as AuthorSnapshot|null,target=s?authorBrowserTarget(s):null;window.dispatchEvent(new CustomEvent("eureka:authoring-state",{detail:s?{sessionId,taskId:s.task.id,ownerKey:s.ownerKey,runtimeId:s.runtimeId,active:s.active&&!s.state.candidate?.saved,appId:target?.appId??null,runId:target?.runId}:null}));}catch(e){if(!disposed&&!abort.signal.aborted)setError(e instanceof Error?e.message:translation.current("automationUi.creationUnavailable"));}if(!disposed)timer=setTimeout(()=>void poll(),1200);}void poll();return()=>{disposed=true;abort.abort();clearTimeout(timer);window.dispatchEvent(new CustomEvent("eureka:authoring-state",{detail:{sessionId,active:false}}));};},[sessionId]);
  const c=snapshot?.state.candidate,explorer=snapshot?.state.explorer;
  useEffect(()=>{if(snapshot?.run?.status==="waiting-user")setPreviewOpen(true);},[snapshot?.run?.id,snapshot?.run?.status]);
  useEffect(()=>{if(c?.digest||explorer?.run.question||explorer?.run.browserApproval)card.current?.scrollIntoView({block:"nearest"});},[c?.digest,explorer?.run.question?.id,explorer?.run.browserApproval?.id]);
  async function post(mode:string,extra:Record<string,unknown>={}){if(!snapshot||posting.current)return false;const expectedSession=sessionId,expectedTask=snapshot.task.id;posting.current=true;setBusy(true);setError("");try{const response=await fetch("/api/automation/authoring",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,sessionId,taskId:snapshot.task.id,ownerKey:snapshot.ownerKey,runtimeId:snapshot.runtimeId,...extra}),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw new Error(data.error);if(currentSession.current!==expectedSession||currentTask.current!==expectedTask)return false;if(mode==="save"){setSnapshot(old=>{const candidate=old?.state.candidate;if(!old||old.task.id!==expectedTask||!candidate||candidate.digest!==extra.digest)return old;return {...old,active:false,state:{...old.state,candidate:{...candidate,saved:data}}};});window.dispatchEvent(new Event("eureka:authoring-saved"));saved.current();}return true;}catch(e){if(currentSession.current===expectedSession&&currentTask.current===expectedTask)setError(e instanceof Error?e.message:t("automationUi.creationIncomplete"));return false;}finally{posting.current=false;setBusy(false);}}
  if(!snapshot)return error?<p role="alert" className={styles.error}>{error}</p>:null;
  if(!c&&!explorer?.run.question&&!explorer?.run.browserApproval)return error?<p role="alert" className={styles.error}>{error}</p>:null;
  const index={ownerKey:snapshot.ownerKey,runtimeId:snapshot.runtimeId,apps:[],data:[]};
  const name=c?.saved?.displayName??(nameDraft?.taskId===snapshot.task.id?nameDraft.value:c?.saveIntent?.displayName??snapshot.detail?.manifest.displayName??"");
  const validation=c?.validation?.digest===c?.digest&&c?.validation?.runId===c?.runId?c?.validation:undefined;
  const passed=validation?.status==="passed"&&snapshot.run?.status==="completed";
  return <section ref={card} className={`${styles.application} ${styles.authoringCard}`} aria-label={t("automationUi.creationResult")}>
    <div className={styles.authoringHeader}><h3>{t("automationUi.app")}</h3><span>{c?.saved?t("automationUi.saved"):!snapshot.active?t("automationUi.paused"):passed?t("automationUi.readyToSave"):c?t("automationUi.generated"):t("automationUi.waitingHelp")}</span></div>{error&&<p role="alert" className={styles.error}>{error}</p>}
    {c&&snapshot.detail&&<>
      <div className={styles.authoringField}>{c.saved?<span className={styles.authoringLabel}>{t("automationUi.appName")}</span>:<label htmlFor={`application-name-${snapshot.task.id}`}>{t("automationUi.appName")}</label>}{c.saved?<p className={styles.authoringName}>{name}</p>:<Input className={styles.authoringNameInput} id={`application-name-${snapshot.task.id}`} value={name} maxLength={100} disabled={busy||!snapshot.active} placeholder={t("automationUi.enterAppName")} onChange={event=>setNameDraft({taskId:snapshot.task.id,value:event.target.value})}/>}</div>
      <dl className={styles.authoringFields}>
        <div><dt>{t("automationUi.parameters")}</dt><dd>{snapshot.detail.ui.fields.map(field=>field.label).join(locale === "zh-CN" ? "、" : ", ")||t("automationUi.noParams")}</dd></div>
        <div><dt>{t("automationUi.outputs")}</dt><dd>{snapshot.detail.ui.results.columns.map(column=>column.label).join(locale === "zh-CN" ? "、" : ", ")||(snapshot.detail.manifest.automation.capabilities.includes("artifacts")?t("automationUi.resultsAndFiles"):t("automationUi.runResults"))}</dd></div>
        <div><dt>{t("automationUi.trialRun")}</dt><dd>{statuses[snapshot.run?.status??""]??t("automationUi.notStarted")}</dd></div>
        <div><dt>{t("automationUi.validation")}</dt><dd>{validation?.status==="passed"?t("automationUi.passed"):validation?.status==="failed"?t("automationUi.notPassed"):t("automationUi.pendingValidation")}</dd></div>
      </dl>
      {c.lastError&&<p role="alert" className={styles.error}>{c.lastError}</p>}
      <Collapsible className={styles.authoringDisclosure}><CollapsibleTrigger render={<Button variant="ghost" className={styles.authoringDisclosureTrigger}/>}><span>{t("automationUi.moreDetails")}</span><ChevronDownIcon size={14}/></CollapsibleTrigger><CollapsibleContent className={styles.authoringDetailsBody}>
        <dl className={styles.authoringDetails}><div><dt>{t("automationUi.version")}</dt><dd>{snapshot.detail.manifest.version}</dd></div><div><dt>{t("automationUi.supportedScope")}</dt><dd><ul>{c.scope.map((text,i)=><li key={i}>{text}</li>)}</ul></dd></div>{c.limitations.length>0&&<div><dt>{t("automationUi.limitations")}</dt><dd><ul>{c.limitations.map((text,i)=><li key={i}>{text}</li>)}</ul></dd></div>}
          {validation&&<div><dt>{t("automationUi.validationDetails")}</dt><dd><ul>{validation.checks.map((check,i)=><li key={i}>{check.equal?t("automationUi.matches"):check.reason==="missing-check"?t("automationUi.missingCheck"):check.reason==="missing-evidence"?t("automationUi.missingEvidence"):check.reason==="missing-field"?t("automationUi.missingField"):check.reason==="value-mismatch"?t("automationUi.valueMismatch"):t("automationUi.incompleteComparison")} · {check.label}{!check.equal&&check.hint&&<p>{check.hint}</p>}</li>)}</ul></dd></div>}
        </dl>
      </CollapsibleContent></Collapsible>
      <div className={styles.authoringActions}>
        {c.saved?<Button size="sm" onClick={()=>window.dispatchEvent(new CustomEvent("eureka:open-automation-app",{detail:{id:c.saved!.id}}))}>{t("automationUi.viewAutomation")}</Button>:<><Button size="sm" disabled={busy||!snapshot.active||!passed||!name.trim()} onClick={()=>void post("save",{digest:c.digest,displayName:name})}>{t("automationUi.saveToDirectory")}</Button><Button size="sm" variant="outline" disabled={!snapshot.active} aria-expanded={previewOpen} onClick={()=>setPreviewOpen(value=>!value)}>{previewOpen?t("automationUi.collapsePreview"):t("automationUi.previewApp")}</Button></>}
        {!c.saved&&snapshot.active&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{window.dispatchEvent(new CustomEvent("eureka:automation-pause",{detail:{sessionId,taskId:snapshot.task.id}}));void post("stop");}}>{t("automationUi.stopCreation")}</Button>}
      </div>
      {!c.saved&&snapshot.active&&previewOpen&&<div className={styles.authoringPreview}><AutomationApplication key={`${snapshot.task.id}:${c.digest}`} authoringPreview taskId={snapshot.task.id} detail={{...snapshot.detail,manifest:{...snapshot.detail.manifest,displayName:name.trim()||snapshot.detail.manifest.displayName}}} index={index} active={snapshot.active} providedRunId={c.runId}/></div>}
    </>}
    {explorer&&snapshot.active&&["running","waiting-user","waiting-browser"].includes(explorer.run.status)&&<><AutomationApplicationBrowser view="requests" detail={explorer.detail} index={index} run={explorer.run} running active taskId={snapshot.task.id}/>{explorer.run.question&&<UserInputCard questions={explorer.run.question.questions} onAnswer={(_,responses:UserInputResponse[])=>post("login",{questionId:explorer.run.question!.id,responses})}/>}</>}
  </section>;
}
