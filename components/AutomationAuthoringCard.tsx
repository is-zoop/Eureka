"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect,useRef,useState } from "react";
import { authorBrowserTarget, type AuthorSnapshot, type AuthorCandidate } from "@/lib/automation-authoring-types";
import { appRunActive } from "@/lib/automation-app-run";
import type { UserInputResponse } from "@/lib/user-input";
import { AutomationApplication, type AutomationApplicationHandle } from "./AutomationApplication";
import { AutomationApplicationBrowser } from "./AutomationApplicationBrowser";
import { UserInputCard } from "./UserInputCard";
import { Button } from "./ui/button";
import { readAutomationResponse } from "@/lib/automation-response";
import { fetchLocalRead, isTransientLocalReadError } from "@/lib/local-read";
import { EditLine } from "./ui/editline";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { LabelTooltip } from "./LabelTooltip";
import { Collapsible,CollapsibleTrigger,CollapsibleContent } from "./ui/collapsible";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import styles from "./AutomationApplication.module.css";

export function AutomationAuthoringCard({sessionId,onSaved}:{sessionId:string;onSaved?:()=>void}) {
  const { t, locale } = useI18n();
  const translation = useRef(t); translation.current = t;
  const statuses:Record<string,string>={running:t("automationUi.running"),"waiting-user":t("automationUi.waitingHelp"),"waiting-browser":t("automationUi.waitingBrowser"),cancelling:t("automationUi.stopping"),completed:t("automationUi.completed"),failed:t("automationUi.failed"),cancelled:t("automationUi.cancelled"),interrupted:t("automationUi.interrupted")};
  const [snapshot,setSnapshot]=useState<AuthorSnapshot|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);const card=useRef<HTMLElement>(null),saved=useRef(onSaved);saved.current=onSaved;
  const [nameDraft,setNameDraft]=useState<{taskId:string;value:string}|null>(null),[previewOpen,setPreviewOpen]=useState(false);
  const [expanded,setExpanded]=useState(true),[testOpened,setTestOpened]=useState(false);
  const [refreshing,setRefreshing]=useState(false),[pollRevision,setPollRevision]=useState(0);
  const readSequence=useRef(0),preview=useRef<AutomationApplicationHandle>(null);
  const posting=useRef(false),currentSession=useRef(sessionId),currentTask=useRef<string|undefined>(undefined);currentSession.current=sessionId;currentTask.current=snapshot?.task.id;
  useEffect(()=>{setSnapshot(null);setNameDraft(null);setPreviewOpen(false);setTestOpened(false);setExpanded(true);setRefreshing(false);setError("");return()=>{window.dispatchEvent(new CustomEvent("eureka:authoring-state",{detail:{sessionId,active:false}}));};},[sessionId]);
  useEffect(()=>{
    let disposed=false,reading=false,failures=0,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
    async function poll(){
      if(reading||disposed)return;
      if(document.visibilityState==="hidden"){timer=setTimeout(()=>void poll(),5000);return;}
      if(posting.current){if(!disposed)timer=setTimeout(()=>void poll(),1200);return;}
      const sequence=++readSequence.current;let terminal=false;reading=true;
      try{
        const response=await fetchLocalRead(`/api/automation/authoring?${new URLSearchParams({sessionId})}`,{signal:abort.signal,timeoutMs:10000});
        terminal=[401,403,404,409].includes(response.status);
        const data=await readAutomationResponse<unknown>(response,translation.current("automationUi.creationUnavailable"),translation.current("automationUi.invalidResponse",{status:response.status}));
        if(disposed||sequence!==readSequence.current)return;
        failures=0;setSnapshot(data as AuthorSnapshot|null);setError("");
        const s=data as AuthorSnapshot|null,target=s?authorBrowserTarget(s):null;
        window.dispatchEvent(new CustomEvent("eureka:authoring-state",{detail:s?{sessionId,taskId:s.task.id,ownerKey:s.ownerKey,runtimeId:s.runtimeId,active:s.active&&!s.state.candidate?.saved,appId:target?.appId??null,runId:target?.runId}:null}));
      }catch(e){failures++;if(!disposed&&!abort.signal.aborted&&sequence===readSequence.current)setError(isTransientLocalReadError(e)?translation.current("automationUi.reconnecting"):e instanceof Error?e.message:translation.current("automationUi.creationUnavailable"));}
      finally{reading=false;if(!disposed){if(!posting.current&&sequence===readSequence.current)setRefreshing(false);if(!terminal)timer=setTimeout(()=>void poll(),Math.min(15000,1200*2**Math.min(failures,4)));}}
    }
    const resume=()=>{if(document.visibilityState==="visible"){clearTimeout(timer);void poll();}};
    document.addEventListener("visibilitychange",resume);
    void poll();return()=>{disposed=true;abort.abort();clearTimeout(timer);document.removeEventListener("visibilitychange",resume);};
  },[sessionId,pollRevision]);
  const c=snapshot?.state.candidate,explorer=snapshot?.state.explorer;
  useEffect(()=>{if(snapshot?.run?.status==="waiting-user"){setPreviewOpen(true);setTestOpened(true);setExpanded(true);}},[snapshot?.run?.id,snapshot?.run?.status]);
  useEffect(()=>{if(c?.digest||explorer?.run.question||explorer?.run.browserApproval)card.current?.scrollIntoView({block:"nearest"});},[c?.digest,explorer?.run.question?.id,explorer?.run.browserApproval?.id]);
  async function post(mode:string,extra:Record<string,unknown>={}){if(!snapshot||posting.current)return false;const expectedSession=sessionId,expectedTask=snapshot.task.id;posting.current=true;readSequence.current++;setBusy(true);setError("");try{const response=await fetch("/api/automation/authoring",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,sessionId,taskId:snapshot.task.id,ownerKey:snapshot.ownerKey,runtimeId:snapshot.runtimeId,...extra}),signal:AbortSignal.timeout(30000)});const data=await readAutomationResponse<unknown>(response,translation.current("automationUi.creationUnavailable"),translation.current("automationUi.invalidResponse",{status:response.status}));if(currentSession.current!==expectedSession||currentTask.current!==expectedTask)return false;if(mode==="refresh"){setSnapshot(data as AuthorSnapshot|null);preview.current?.refresh();}if(mode==="save"){setSnapshot(old=>{const candidate=old?.state.candidate;if(!old||old.task.id!==expectedTask||!candidate||candidate.digest!==extra.digest)return old;return {...old,state:{...old.state,candidate:{...candidate,saved:data as AuthorCandidate["saved"]}}};});window.dispatchEvent(new Event("eureka:authoring-saved"));saved.current?.();}return true;}catch(e){if(currentSession.current===expectedSession&&currentTask.current===expectedTask)setError(e instanceof Error?e.message:t("automationUi.creationIncomplete"));return false;}finally{posting.current=false;if(currentSession.current===expectedSession)setBusy(false);}}
  async function refresh(){if(posting.current||refreshing)return;const expectedSession=sessionId;setRefreshing(true);if(!snapshot){setPollRevision(value=>value+1);return;}try{await post("refresh");}finally{if(currentSession.current===expectedSession)setRefreshing(false);}}
  const refreshButton=<LabelTooltip content={t("automationUi.refreshCreation")}><Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={busy||refreshing} aria-label={t("automationUi.refreshCreation")} aria-busy={refreshing} onClick={()=>void refresh()}><RefreshCwIcon size={14} className={refreshing?"animate-spin":undefined}/></Button></LabelTooltip>;
  const loadError=error?<section className={`${styles.application} ${styles.authoringCard}`} aria-label={t("automationUi.creationResult")}><div className={styles.authoringHeader}><h3>{t("automationUi.app")}</h3>{refreshButton}</div><p role="alert" className={styles.error}>{error}</p></section>:null;
  if(!snapshot)return loadError;
  if(!c&&!explorer?.run.question&&!explorer?.run.browserApproval)return loadError;
  const index={ownerKey:snapshot.ownerKey,runtimeId:snapshot.runtimeId,apps:[],data:[]};
  const name=c?.saved?.displayName??(nameDraft?.taskId===snapshot.task.id?nameDraft.value:c?.saveIntent?.displayName??snapshot.state.displayName??snapshot.detail?.manifest.displayName??"");
  const validation=c?.validation?.digest===c?.digest&&c?.validation?.runId===c?.runId?c?.validation:undefined;
  const runActive=Boolean(snapshot.run&&appRunActive(snapshot.run.status));
  return <section ref={card} className={`${styles.application} ${styles.authoringCard}`} aria-label={t("automationUi.creationResult")}>
    <Collapsible open={expanded} onOpenChange={setExpanded}>
    <div className={styles.authoringHeader}><h3><CollapsibleTrigger render={<Button variant="ghost" className={styles.authoringCardTrigger}/>}><ChevronDownIcon size={16}/>{t("automationUi.app")}</CollapsibleTrigger></h3><div className={styles.authoringHeaderActions}><span className={styles.authoringStatus}>{c?.saved?t("automationUi.saved"):!snapshot.active?t("automationUi.paused"):c?t(runActive?"automationUi.generated":"automationUi.readyToSave"):t("automationUi.waitingHelp")}</span>{refreshButton}</div></div>
    <CollapsibleContent keepMounted className={styles.authoringBody}>{error&&<p role="alert" className={styles.error}>{error}</p>}
    {c&&snapshot.detail&&<>
      <Tabs className={styles.authoringTabs} value={previewOpen?"test":"info"} onValueChange={value=>{setPreviewOpen(value==="test");if(value==="test")setTestOpened(true);}}>
        <TabsList aria-label={t("automationUi.app")}><TabsTrigger id={`authoring-info-tab-${snapshot.task.id}`} aria-controls={`authoring-info-${snapshot.task.id}`} value="info">{t("automationUi.appInfo")}</TabsTrigger><TabsTrigger id={`authoring-test-tab-${snapshot.task.id}`} aria-controls={`authoring-test-${snapshot.task.id}`} value="test">{t("automationUi.runTest")}</TabsTrigger></TabsList>
      </Tabs>
      <div role="tabpanel" id={`authoring-info-${snapshot.task.id}`} aria-labelledby={`authoring-info-tab-${snapshot.task.id}`} hidden={previewOpen} className={styles.authoringInfo}>
      <div className={styles.authoringIdentity}>
        <div className={styles.authoringField}><span className={styles.authoringLabel}>{t("automationUi.appName")}</span>{c.saved?<p className={styles.authoringName}>{name}</p>:<EditLine className={styles.authoringNameInput} id={`application-name-${snapshot.task.id}`} aria-label={t("automationUi.appName")} value={name} maxLength={100} disabled={busy||!snapshot.active} placeholder={t("automationUi.enterAppName")} onValueChange={value=>setNameDraft({taskId:snapshot.task.id,value})}/>}</div>
        <div className={styles.authoringField}><span className={styles.authoringLabel}>{t("automationUi.version")}</span><p className={styles.authoringName}>{c.saved?.version??snapshot.detail.manifest.version}</p></div>
      </div>
      <dl className={styles.authoringFields}>
        {Boolean(snapshot.detail.actions?.length)&&<div><dt>{t("automationUi.functions")}</dt><dd>{snapshot.detail.actions!.map(action=>action.label).join(locale==="zh-CN"?"、":", ")}</dd></div>}
        <div><dt>{t("automationUi.parameters")}</dt><dd>{snapshot.detail.ui.fields.map(field=>field.label).join(locale === "zh-CN" ? "、" : ", ")||t("automationUi.noParams")}</dd></div>
        <div><dt>{t("automationUi.outputs")}</dt><dd>{snapshot.detail.ui.results.columns.map(column=>column.label).join(locale === "zh-CN" ? "、" : ", ")||(snapshot.detail.manifest.automation.capabilities.includes("artifacts")?t("automationUi.resultsAndFiles"):t("automationUi.runResults"))}</dd></div>
        <div><dt>{t("automationUi.trialRun")}</dt><dd>{statuses[snapshot.run?.status??""]??t("automationUi.notStarted")}</dd></div>
        <div><dt>{t("automationUi.validation")}</dt><dd>{t("automationUi.manualOnly")}</dd></div>
      </dl>
      {c.lastError&&<p role="alert" className={styles.error}>{c.lastError}</p>}
      <Collapsible className={styles.authoringDisclosure}><CollapsibleTrigger render={<Button variant="ghost" className={styles.authoringDisclosureTrigger}/>}><span>{t("automationUi.moreDetails")}</span><ChevronDownIcon size={14}/></CollapsibleTrigger><CollapsibleContent className={styles.authoringDetailsBody}>
        <dl className={styles.authoringDetails}><div><dt>{t("automationUi.supportedScope")}</dt><dd><ul>{c.scope.map((text,i)=><li key={i}>{text}</li>)}</ul></dd></div>{c.limitations.length>0&&<div><dt>{t("automationUi.limitations")}</dt><dd><ul>{c.limitations.map((text,i)=><li key={i}>{text}</li>)}</ul></dd></div>}
          {validation&&<div><dt>{t("automationUi.validationDetails")}</dt><dd><ul>{validation.checks.map((check,i)=><li key={i}>{check.equal?t("automationUi.matches"):check.reason==="missing-check"?t("automationUi.missingCheck"):check.reason==="missing-evidence"?t("automationUi.missingEvidence"):check.reason==="missing-field"?t("automationUi.missingField"):check.reason==="value-mismatch"?t("automationUi.valueMismatch"):t("automationUi.incompleteComparison")} · {check.label}{!check.equal&&check.hint&&<p>{check.hint}</p>}</li>)}</ul></dd></div>}
        </dl>
      </CollapsibleContent></Collapsible>
      </div>
      <div role="tabpanel" id={`authoring-test-${snapshot.task.id}`} aria-labelledby={`authoring-test-tab-${snapshot.task.id}`} hidden={!previewOpen}>
      {testOpened&&<div className={styles.authoringPreview}><AutomationApplication ref={preview} key={`${snapshot.task.id}:${c.digest}`} authoringPreview taskId={snapshot.task.id} detail={{...snapshot.detail,manifest:{...snapshot.detail.manifest,displayName:name.trim()||snapshot.detail.manifest.displayName}}} index={index} active={snapshot.active} providedRunId={c.runId} providedActionId={c.actionId??snapshot.run?.actionId} providedRunIds={Object.fromEntries(Object.entries(c.actionTrials??{}).filter(([,trial])=>Boolean(trial.runId)).map(([id,trial])=>[id,trial.runId!]))}/></div>}
      </div>
    </>}
    {explorer&&snapshot.active&&["running","waiting-user","waiting-browser"].includes(explorer.run.status)&&<><AutomationApplicationBrowser view="requests" detail={explorer.detail} index={index} run={explorer.run} running active taskId={snapshot.task.id}/>{explorer.run.question&&<UserInputCard questions={explorer.run.question.questions} onAnswer={(_,responses:UserInputResponse[])=>post("login",{questionId:explorer.run.question!.id,responses})}/>}</>}
    </CollapsibleContent>
    </Collapsible>
    {c&&snapshot.detail&&<>
      <div className={styles.authoringActions}>
        {c.saved?<Button size="sm" onClick={()=>window.dispatchEvent(new CustomEvent("eureka:open-automation-app",{detail:{id:c.saved!.id}}))}>{t("automationUi.viewAutomation")}</Button>:<><Button size="sm" disabled={busy||!snapshot.active||runActive||!name.trim()} onClick={()=>void post("save",{digest:c.digest,displayName:name})}>{t("automationUi.saveToDirectory")}</Button></>}
        {!c.saved&&snapshot.active&&<Button size="sm" variant="ghost" className="bg-[var(--danger-hover)] text-[var(--danger)] hover:bg-[var(--danger-hover)] focus-visible:bg-[var(--danger-hover)] focus-visible:outline-[var(--danger)]" disabled={busy} onClick={()=>{window.dispatchEvent(new CustomEvent("eureka:automation-pause",{detail:{sessionId,taskId:snapshot.task.id}}));void post("stop");}}>{t("automationUi.stopCreation")}</Button>}
      </div>
    </>}
  </section>;
}
