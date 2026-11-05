"use client";
import { useI18n } from "@/hooks/useI18n";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AutomationAppDetail, AutomationAppIndex } from "@/lib/automation-app";
import { appActionDetail, appActions } from "@/lib/automation-app-actions";
import { appJsonValue, appRunActive, newestAppRuns, type AppConfiguration, type AppFileRef, type AppJson, type AppRunEvent, type AppRunRecord } from "@/lib/automation-app-run";
import type { UserInputResponse } from "@/lib/user-input";
import { saveFileAs } from "@/lib/save-file";
import { UserInputCard } from "./UserInputCard";
import { NotificationNotice } from "./Notifications";
import { notify } from "@/lib/notification-store";
import { automationRunFailureNotice } from "@/lib/automation-run-notice";
import { AutomationApplicationBrowser } from "./AutomationApplicationBrowser";
import { AutomationRunSplit } from "./AutomationRunSplit";
import { AutomationAppIcon } from "./AutomationAppIcon";
import { LabelTooltip } from "./LabelTooltip";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Card } from "./ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "./ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./ui/dropdown-menu";
import { CheckIcon, PlayIcon, SquareIcon, SlidersHorizontalIcon, ChevronDownIcon, DownloadIcon, LocateFixedIcon, XIcon, CircleHelpIcon, WorkflowIcon } from "lucide-react";
import styles from "./AutomationApplication.module.css";

const display = (value: unknown) => value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export interface AutomationApplicationHandle { canManage: () => boolean; openHistory: () => void; refresh: () => void }
interface ApplicationProps { detail: AutomationAppDetail; index: AutomationAppIndex; active: boolean;taskId?:string;authoringPreview?:boolean;providedRunId?:string;providedActionId?:string;providedRunIds?:Record<string,string>;onRunningChange?:(running:boolean)=>void;onRunChange?:(appId:string,runId:string|null)=>void }
export const AutomationApplication = forwardRef<AutomationApplicationHandle, ApplicationProps>(function AutomationApplication(props, ref) {
  const options = appActions(props.detail);
  const preferenceKey=`eureka:app-function:${props.index.ownerKey}:${props.detail.install.id}`;
  const [selected, setSelected] = useState(()=>{if(props.providedActionId)return props.providedActionId;try{return sessionStorage.getItem(preferenceKey)??options[0]?.id??"";}catch{return options[0]?.id??"";}});
  useEffect(() => {
    if (props.providedActionId && options.some(action => action.id === props.providedActionId)) setSelected(props.providedActionId);
  }, [props.providedActionId, props.providedRunId]);
  useEffect(() => {
    setSelected(previous => options.some(action => action.id === previous) ? previous : options[0]?.id ?? "");
  }, [props.detail.actions, props.detail.ui.buttons]);
  if (!options.length) return null;
  const id = options.some(action => action.id === selected) ? selected : options[0].id;
  const detail = appActionDetail(props.detail, id);
  const providedRunId = props.providedRunIds?.[id] ?? ((!props.providedActionId || props.providedActionId === id) ? props.providedRunId : undefined);
  return <AutomationActionApplication {...props} ref={ref} key={`${props.detail.install.id}:${id}`} detail={detail} providedRunId={providedRunId} actionOptions={options} onActionSelect={value=>{setSelected(value);try{sessionStorage.setItem(preferenceKey,value);}catch{}}} />;
});
const AutomationActionApplication = forwardRef<AutomationApplicationHandle, ApplicationProps & {actionOptions:{id:string;label:string;description?:string}[];onActionSelect:(id:string)=>void}>(function AutomationActionApplication({ detail, index, active,taskId,authoringPreview=false,providedRunId,onRunningChange,onRunChange,actionOptions,onActionSelect }, ref) {
  const { t, locale } = useI18n();
  const translation = useRef(t); translation.current = t;
  const statusNames: Record<string, string> = { running: t("automationUi.running"), "waiting-user": t("automationUi.waitingAnswer"), "waiting-browser": t("automationUi.waitingBrowser"), cancelling: t("automationUi.cancelling"), completed: t("automationUi.completed"), failed: t("automationUi.failed"), cancelled: t("automationUi.cancelled"), interrupted: t("automationUi.interrupted"), idle: t("automationUi.notRun"), info: t("automationUi.logs"), console: t("automationUi.console"), created: t("automationUi.generated"), answered: t("automationUi.answered"), browser: t("automationUi.browserActivity"), authorized: t("automationUi.authorized") };
  const [config, setConfig] = useState<AppConfiguration | null>(null), [values, setValues] = useState<Record<string, AppJson>>({}), [editors, setEditors] = useState<Record<string, string>>({});
  const [paths, setPaths] = useState<Record<string, string>>({}), [access, setAccess] = useState<Record<string, "read" | "readwrite">>({});
  const [history, setHistory] = useState<AppRunRecord[]>([]), [runId, setRunId] = useState<string | null>(null), [run, setRun] = useState<AppRunRecord | null>(null);
  const previousNoticeRun = useRef<Pick<AppRunRecord,"id"|"status"|"error"> | null>(null);
  const noticeScope = `${index.ownerKey}:${index.runtimeId}:${detail.install.id}:${detail.actionId??"default"}:${taskId ?? "installed"}`;
  useEffect(() => {
    if (!active) { previousNoticeRun.current = null; return; }
    if (!run) return;
    const notice = automationRunFailureNotice(noticeScope, previousNoticeRun.current, run);
    previousNoticeRun.current = { id: run.id, status: run.status, error: run.error };
    if (notice) notify(notice);
  }, [active, noticeScope, run?.id, run?.status, run?.error]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onRunChange?.(detail.install.id, active && loaded ? runId : null);
    return () => onRunChange?.(detail.install.id, null);
  }, [active, loaded, runId, detail.install.id, onRunChange]);
  const [selectedEvent, setSelectedEvent] = useState<AppRunEvent | null>(null), [io, setIo] = useState<{ input?: unknown; output?: unknown }>({}), [result, setResult] = useState<unknown>(undefined);
  const alive = useRef(true), activeRef = useRef(active), sequence = useRef(0), acting = useRef(false), canvasRef = useRef<HTMLDivElement>(null), followRef = useRef(true);
  const [follow, setFollow] = useState(true);
  const [configOpen, setConfigOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [detailsOpen, setDetailsOpen] = useState(false), [assistanceOpen, setAssistanceOpen] = useState(false);
  const [configTab,setConfigTab]=useState("parameters");
  const [dataTab, setDataTab] = useState("results"), [detailTab, setDetailTab] = useState("input"), [selectedNode, setSelectedNode] = useState<string | null>(null);
  const actionId = detail.actionId ?? detail.ui.buttons[0]?.id ?? "";
  const canvasScrollRef = useRef<HTMLDivElement>(null), logsRef = useRef<HTMLDivElement>(null), logFollow = useRef(true), dataTabTouched = useRef(false);

  const pendingStart = useRef<{ runId: string; configRevision: number; values: Record<string, AppJson>; actionId: string } | null>(null);
  const [retryStart, setRetryStart] = useState(false);
  const [geometry, setGeometry] = useState<{ width: number; height: number; paths: { d: string; label: string }[] }>({ width: 0, height: 0, paths: [] });
  activeRef.current = active;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const endpoint = `/api/automation/apps/${detail.install.id}/runtime`;
  function query(mode: string, extra: Record<string, string> = {}) { return new URLSearchParams({ mode, ownerKey: index.ownerKey, runtimeId: index.runtimeId,...(taskId?{taskId}:{}), ...(detail.actionId?{actionId:detail.actionId}:{}), ...extra }); }
  async function get<T>(mode: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${endpoint}?${query(mode, extra)}`, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    const data = await response.json(); if (!response.ok) throw new RequestError(data.error ?? translation.current("automationUi.readFailed"), response.status); return data;
  }
  async function post<T>(action: string, data: Record<string, unknown>): Promise<T> {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ownerKey: index.ownerKey, runtimeId: index.runtimeId,taskId, actionId:detail.actionId, revision: detail.install.revision, ...data }), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); if (!response.ok) throw new RequestError(result.error ?? translation.current("automationUi.incomplete"), response.status); return result;
  }
  function failure(cause: unknown) { return cause instanceof Error ? cause.name === "TimeoutError" ? translation.current("automationUi.startTimeout") : cause.message : translation.current("automationUi.operationFailed"); }
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController(); setLoaded(false); setError("");
    void Promise.all([get<AppConfiguration>("config", {}, abort.signal), get<AppRunRecord[]>("runs", {}, abort.signal)]).then(([configuration, runs]) => {
      if (abort.signal.aborted) return;
      const seeded = configuration.values;
      const merged = Object.fromEntries(detail.ui.fields.map(field => [field.id, Object.hasOwn(seeded, field.id) ? seeded[field.id] : appJsonValue(field.default ?? null)]));
      const orderedRuns = newestAppRuns(runs);
      setConfig(configuration); setValues(merged); setEditors({}); setHistory(orderedRuns); setRunId(providedRunId ?? (authoringPreview ? null : orderedRuns.find(item => appRunActive(item.status))?.id ?? orderedRuns[0]?.id ?? null)); setLoaded(true);
    }).catch(cause => { if (!abort.signal.aborted) setError(failure(cause)); });
    return () => abort.abort();
  }, [active, detail.install.id, detail.manifest.version, refresh,providedRunId,authoringPreview]);
  useEffect(() => {
    const token = ++sequence.current; setRun(null); setSelectedEvent(null); setSelectedNode(null); setDetailsOpen(false); setIo({}); setResult(undefined);
    if (!active || !runId) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, snapshot: AppRunRecord | null = null;
    const poll = async () => {
      try {
        const record = await get<AppRunRecord>("run", { runId, after: String(snapshot?.events.at(-1)?.seq ?? 0) }, abort.signal);
        if (abort.signal.aborted || token !== sequence.current) return;
        if (detail.actionId && record.actionId !== detail.actionId) throw new Error(translation.current("automationUi.wrongActionRun"));
        const merged: AppRunRecord = { ...record, events: [...new Map([...(snapshot?.events ?? []), ...record.events].map(event => [event.seq, event])).values()] };
        snapshot = merged; setRun(merged); setHistory(previous => newestAppRuns([merged, ...previous.filter(item => item.id !== merged.id)]));
        const current = [...merged.events].reverse().find(event => event.kind === "node");
        if (current) setSelectedEvent(previous => !previous || followRef.current ? current : previous);
        if (appRunActive(merged.status)) timer = setTimeout(() => void poll(), 1200);
      } catch (cause) { if (!abort.signal.aborted && token === sequence.current) { setError(failure(cause)); timer = setTimeout(() => void poll(), 3000); } }
    };
    void poll(); return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [active, runId, detail.install.id]);
  useEffect(() => {
    if (!follow || !selectedEvent?.nodeId) return;
    setSelectedNode(selectedEvent.nodeId);
    const scroll = canvasScrollRef.current, node = canvasRef.current?.querySelector(`[data-node-id="${selectedEvent.nodeId}"]`);
    if (!scroll || !node) return;
    const view = scroll.getBoundingClientRect(), rect = node.getBoundingClientRect();
    if (rect.top < view.top) scroll.scrollTop -= view.top - rect.top + 16;
    else if (rect.bottom > view.bottom) scroll.scrollTop += rect.bottom - view.bottom + 16;
    if (rect.left < view.left) scroll.scrollLeft -= view.left - rect.left + 16;
    else if (rect.right > view.right) scroll.scrollLeft += rect.right - view.right + 16;
  }, [follow, selectedEvent?.seq]);
  useEffect(() => {
    const abort = new AbortController(); setResult(undefined);
    if (active && run?.resultRef) void get("value", { runId: run.id, ref: run.resultRef }, abort.signal).then(value => { if (!abort.signal.aborted) setResult(value); }).catch(cause => { if (!abort.signal.aborted) setError(failure(cause)); });
    return () => abort.abort();
  }, [active, run?.id, run?.resultRef]);
  useEffect(() => {
    const abort = new AbortController(); setIo({}); if (!active || !run || !selectedEvent) return;
    const start = run.events.find(event => event.kind === "node" && event.nodeId === selectedEvent.nodeId && event.execution === selectedEvent.execution && event.status === "running");
    void Promise.all([start?.inputRef ? get("value", { runId: run.id, ref: start.inputRef }, abort.signal) : undefined, selectedEvent.outputRef ? get("value", { runId: run.id, ref: selectedEvent.outputRef }, abort.signal) : undefined]).then(([input, output]) => { if (!abort.signal.aborted) setIo({ input, output }); }).catch(cause => { if (!abort.signal.aborted) setError(failure(cause)); });
    return () => abort.abort();
  }, [active, run?.id, selectedEvent?.seq]);
  async function work(task: () => Promise<void>) {
    if (acting.current || !active) return; acting.current = true; setBusy(true); setError("");
    try { await task(); } catch (cause) { if (alive.current) setError(failure(cause)); }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }
  function collect() {
    return Object.fromEntries(detail.ui.fields.map(field => {
      if (["object", "list"].includes(field.type) && Object.hasOwn(editors, field.id)) {
        try { return [field.id, editors[field.id].trim() ? JSON.parse(editors[field.id]) : null]; }
        catch { throw new Error(t("automationUi.invalidJson", { name: field.label })); }
      }
      return [field.id, values[field.id] ?? null];
    }));
  }
  async function save() { await work(async () => { const saved = await post<AppConfiguration>("save", { configRevision: config!.revision, values: collect() }); if (alive.current) { setConfig(saved); setConfigOpen(false); } }); }
  async function start(actionId?: string) {
    await work(async () => {
      if (!pendingStart.current) pendingStart.current = { runId: crypto.randomUUID(), configRevision: config!.revision, values: collect(), actionId: actionId ?? detail.ui.buttons[0]?.id ?? "" };
      let accepted = false;
      try {
        const submitted = pendingStart.current;
        const record = await post<AppRunRecord>("start", submitted); accepted = true; if (!alive.current) return;
        // An explicit start may already return a terminal failure. Unlike
        // loading history, this is feedback for the user's current action.
        const startNotice = automationRunFailureNotice(noticeScope, { id: record.id, status: "running" }, record);
        if (startNotice) notify(startNotice);
        pendingStart.current = null; setRetryStart(false); followRef.current = true; setFollow(true); setRun(record); setHistory(previous => newestAppRuns([record, ...previous.filter(item => item.id !== record.id)])); setRunId(record.id); setDataTab("logs"); dataTabTouched.current = false; logFollow.current = true;
        setConfig(previous => previous ? { ...previous, revision: submitted.configRevision + 1 } : previous); setConfig(await get<AppConfiguration>("config"));
      } catch (cause) {
        if (accepted) { setError(t("automationUi.configReadFailed")); return; }
        if (cause instanceof RequestError && cause.status >= 400 && cause.status < 500) { pendingStart.current = null; setRetryStart(false); }
        else setRetryStart(true);
        throw cause;
      }
    });
  }
  async function choose(fieldId: string, type: "file" | "directory") {
    await work(async () => {
      let selected = paths[fieldId] ?? "";
      if ("__TAURI_INTERNALS__" in window) {
        if (type === "directory") selected = await invoke<string | null>("desktop_select_directory", { cwd: null }) ?? "";
        else { const files = await invoke<string[]>("desktop_select_attachments", { cwd: null }); if (files.length > 1) throw new Error(t("automationUi.oneFile")); selected = files[0] ?? ""; }
      }
      if (!selected || !alive.current || !activeRef.current) return;
      const previous = values[fieldId] as unknown as AppFileRef | null;
      const ref = await post<AppFileRef>("grant", { fieldId, path: selected, access: access[fieldId] ?? previous?.access ?? "read" }); if (alive.current) setValues(old => ({ ...old, [fieldId]: ref as unknown as AppJson }));
    });
  }
  async function stop() { if (!run) return; await work(async () => { const record = await post<AppRunRecord>("stop", { runId: run.id }); if (alive.current) setRun(record); }); }
  async function answer(responses: UserInputResponse[]) {
    if (!run?.question) return false;
    let ok = false; await work(async () => { const record = await post<AppRunRecord>("answer", { runId: run.id, questionId: run.question!.id, responses }); if (alive.current) { setRun(record); ok = true; } }); return ok;
  }
  async function downloadArtifact(id: string, name: string) {
    if (!run) return;
    const token = sequence.current;
    await work(async () => {
      await saveFileAs(name, async () => {
        const response = await fetch(`${endpoint}?${query("artifact", { runId: run.id, artifactId: id })}`, { cache: "no-store", signal: AbortSignal.timeout(30000) }); if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
        return response.blob();
      }, () => alive.current && activeRef.current && sequence.current === token);
    });
  }
  const running = Boolean(run && appRunActive(run.status)), readingRun = Boolean(runId && !run), locked = busy || !active || !loaded || running || readingRun || retryStart;
  const workflow = run?.workflow ?? detail.workflow, nodes = workflow.nodes;
  const rows = Array.isArray(result) ? result : result && typeof result === "object" ? [result] : null;
  const columns = run?.resultColumns ?? detail.ui.results.columns;
  useImperativeHandle(ref, () => ({
    canManage: () => !authoringPreview && active && !busy && !running && !retryStart && !readingRun,
    openHistory: () => { if (!authoringPreview && active && !busy && !running && !retryStart && !readingRun) setHistoryOpen(true); },
    refresh: () => { if (!authoringPreview && active && !busy && !running && !retryStart && !readingRun) setRefresh(n => n + 1); },
  }));
  useEffect(() => { onRunningChange?.(active && (busy || running || retryStart || readingRun)); }, [active, busy, running, retryStart, readingRun, onRunningChange]);
  useEffect(() => { const waiting = Boolean(run?.status === "waiting-user" && (run.question || run.browserApproval)); setAssistanceOpen(waiting); if (waiting) setDetailsOpen(false); }, [run?.question?.id, run?.browserApproval?.id, run?.status]);
  useEffect(() => { if (result !== undefined && !dataTabTouched.current) setDataTab("results"); }, [result]);
  useEffect(() => { if (dataTab === "logs" && logFollow.current && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [run?.events.length, dataTab]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const rect = canvas.getBoundingClientRect();
        const positions = new Map(nodes.map(node => { const item = canvas.querySelector(`[data-node-id="${node.id}"]`)?.getBoundingClientRect(); return [node.id, item ? { x: item.left - rect.left, y: item.top - rect.top, width: item.width, height: item.height } : null] as const; }));
        const paths = workflow.edges.flatMap(edge => {
          const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return [];
          let d: string;
          if (edge.from === edge.to) { const x = from.x + from.width * .7, y = from.y; d = `M ${x} ${y} C ${x} ${y - 20}, ${x + 32} ${y - 20}, ${x + 32} ${y}`; }
          else if (to.y > from.y + from.height / 2) { const x1 = from.x + from.width / 2, y1 = from.y + from.height, x2 = to.x + to.width / 2, y2 = to.y; d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`; }
          else { const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2; d = `M ${x1} ${y1} C ${x1 + 12} ${y1}, ${x2 - 12} ${y2}, ${x2} ${y2}`; }
          return [{ d, label: edge.label ?? translation.current("automationUi.workflowConnection") }];
        });
        setGeometry({ width: rect.width, height: rect.height, paths });
      });
    };
    const observer = new ResizeObserver(measure); observer.observe(canvas); canvas.querySelectorAll("button").forEach(node => observer.observe(node)); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [workflow, nodes]);
  async function downloadResult() {
    if (result === undefined || !run) return;
    const token = sequence.current;
    await work(async () => {
      await saveFileAs(`${detail.manifest.name}-${run.id}.json`, async () => new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" }), () => alive.current && activeRef.current && sequence.current === token);
    });
  }
  const fieldsForm = <div className={styles.fields}>{detail.ui.fields.map(field => {
      const value = values[field.id], fileRef = value && typeof value === "object" ? value as unknown as AppFileRef : null;
      return <div key={field.id} className={styles.field}><label htmlFor={`app-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
        {field.type === "file" || field.type === "directory" ? <>
          <div className={styles.file}><Input id={`app-${field.id}`} readOnly value={fileRef?.label ?? t("automationUi.notSelected")} /><Button type="button" variant="outline" disabled={locked} onClick={() => void choose(field.id, field.type as "file" | "directory")}>{t(field.type === "file" ? "automationUi.selectFile" : "automationUi.selectFolder")}</Button></div>
          {typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && <Input disabled={locked} value={paths[field.id] ?? ""} placeholder={t("automationUi.fullPath")} onChange={e => setPaths(old => ({ ...old, [field.id]: e.target.value }))} />}
          {detail.manifest.automation.capabilities.includes("files.write") && <label className={styles.check}><input type="checkbox" disabled={locked} checked={(access[field.id] ?? fileRef?.access ?? "read") === "readwrite"} onChange={e => { setAccess(old => ({ ...old, [field.id]: e.target.checked ? "readwrite" : "read" })); setValues(old => ({ ...old, [field.id]: null })); }} />{t("automationUi.allowWrite")}</label>}
        </> : field.type === "boolean" ? <Select disabled={locked} value={value === null || value === undefined ? "unset" : value ? "true" : "false"} items={[{value:"unset",label:t("automationUi.unset")},{value:"false",label:t("automationUi.no")},{value:"true",label:t("automationUi.yes")}]} onValueChange={next => {if(next!==null)setValues(old => ({ ...old, [field.id]: next === "unset" ? null : next === "true" }));}}><SelectTrigger id={`app-${field.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">{t("automationUi.unset")}</SelectItem><SelectItem value="false">{t("automationUi.no")}</SelectItem><SelectItem value="true">{t("automationUi.yes")}</SelectItem></SelectContent></Select>
          : field.type === "text" && field.multiline ? <Textarea id={`app-${field.id}`} disabled={locked} rows={4} value={value===null||value===undefined?"":String(value)} onChange={e=>setValues(old=>({...old,[field.id]:e.target.value}))}/>
          : field.type === "object" || field.type === "list" ? <Textarea id={`app-${field.id}`} disabled={locked} rows={4} value={editors[field.id] ?? (value === null || value === undefined ? "" : JSON.stringify(value, null, 2))} onChange={e => setEditors(old => ({ ...old, [field.id]: e.target.value }))} placeholder={field.type === "list" ? t("automationUi.jsonList") : t("automationUi.jsonObject")} />
          : <Input id={`app-${field.id}`} disabled={locked} type={field.type === "number" || field.type === "percentage" ? "number" : field.type === "date" ? "date" : "text"} step="any" value={value === null || value === undefined ? "" : String(value)} onChange={e => setValues(old => ({ ...old, [field.id]: ["number", "percentage"].includes(field.type) ? e.target.value === "" ? null : Number(e.target.value) : e.target.value }))} />}
        {field.description && <small>{field.description}</small>}
      </div>;
    })}</div>;
  const resultBody = result === undefined ? <div className={styles.empty}>{running ? t("automationUi.waitingResults") : t("automationUi.noResults")}</div> : rows && columns.length ? <div className={styles.table}><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(column => <td key={column.key}>{row && typeof row === "object" && Object.hasOwn(row, column.key) ? display((row as Record<string, unknown>)[column.key]) : "—"}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p>{t("automationUi.emptyResults")}</p>}</div> : <pre className={styles.json}>{JSON.stringify(result, null, 2)}</pre>;
  const downloadMenu = <DropdownMenu><DropdownMenuTrigger disabled={busy || !active || running || (!run?.artifacts.length && (result === undefined || !detail.ui.results.download))} render={<Button variant="outline" size="sm" />}><DownloadIcon size={14}/>{t("automationUi.download")}<ChevronDownIcon size={13}/></DropdownMenuTrigger><DropdownMenuContent align="end">
    {result !== undefined && detail.ui.results.download && <DropdownMenuItem onClick={() => void downloadResult()}>{t("automationUi.fullJson")}</DropdownMenuItem>}
    {run?.artifacts.map(artifact => <DropdownMenuItem key={artifact.id} onClick={() => void downloadArtifact(artifact.id, artifact.name)}>{artifact.name}</DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>;
  const requests = <><AutomationApplicationBrowser view="requests" detail={detail} index={index} run={run} running={running} active={active} taskId={taskId}/>{run?.question && run.status === "waiting-user" && <UserInputCard key={run.question.id} questions={run.question.questions} onAnswer={(_, responses) => answer(responses)} />}</>;
  const focusedNode = nodes.find(node => node.id === selectedNode), waiting = run?.status === "waiting-user";
  const completed = nodes.filter(node => run?.events.filter(e => e.kind === "node" && e.nodeId === node.id).at(-1)?.status === "completed").length;
  const status = !active ? "inactive" : !loaded || readingRun ? "loading" : detail.install.disabled && !running ? "disabled" : run?.status ?? "idle";
  const statusText = status === "inactive" ? t("automationUi.leftRun") : status === "loading" ? t("automationUi.reading") : status === "disabled" ? t("automationUi.disabled") : status === "idle" ? t("automationUi.ready") : statusNames[status];
  function selectEvent(event: AppRunEvent) { followRef.current = false; setFollow(false); setSelectedNode(event.nodeId ?? null); setSelectedEvent(event); setDetailsOpen(true); setAssistanceOpen(false); }
  return <section className={styles.executionPage} aria-label={t("automationUi.workbench")}>
    <header className={styles.runHeader}><div className={styles.runTitle}><AutomationAppIcon app={detail.install} identity={index} size={18} /><LabelTooltip content={detail.manifest.displayName}><h2>{detail.manifest.displayName}</h2></LabelTooltip></div><div className={styles.runActions}>
      <Button variant="outline" size="sm" disabled={locked} onClick={() => setConfigOpen(true)}><SlidersHorizontalIcon size={14}/>{t("automationUi.configure")}</Button>
      <ButtonGroup aria-label={t("automationUi.runMode")}>
        {running ? <Button size="sm" disabled={busy || !active || run?.status === "cancelling"} onClick={() => void stop()}><SquareIcon size={13}/>{run?.status === "cancelling" ? t("automationUi.stopping") : t("automationUi.stop")}</Button> : !authoringPreview && <Button size="sm" className="min-w-0" disabled={busy || !active || !loaded || readingRun || detail.install.disabled || !detail.ui.buttons.length} onClick={() => void start(actionId)}><PlayIcon size={14} className="shrink-0"/><span className="truncate">{retryStart ? t("automationUi.retryStart") : actionOptions.length > 1 ? t("automationUi.runAction", {action:detail.ui.buttons[0]?.label??""}) : t("automationUi.start")}</span></Button>}
        {authoringPreview&&!running&&<LabelTooltip content={t("automationUi.authoringTrialOnly")}><Button size="sm" className="min-w-0" disabled><PlayIcon size={14} className="shrink-0"/><span className="truncate">{actionOptions.length>1?t("automationUi.runAction",{action:detail.ui.buttons[0]?.label??""}):t("automationUi.start")}</span></Button></LabelTooltip>}
        {actionOptions.length > 1 && <>
          <ButtonGroupSeparator />
          <DropdownMenu>
            <LabelTooltip content={t("automationUi.selectAction")}><DropdownMenuTrigger disabled={locked} aria-label={t("automationUi.selectAction")} render={<Button size="icon"/>}><ChevronDownIcon size={13}/></DropdownMenuTrigger></LabelTooltip>
            <DropdownMenuContent align="end" className="w-max min-w-48 max-w-[min(18rem,calc(100vw-24px))]">
              <DropdownMenuRadioGroup value={detail.actionId ?? actionId} onValueChange={onActionSelect}>
                {actionOptions.map(action => <DropdownMenuRadioItem key={action.id} value={action.id} label={action.label} indicatorPosition="none" closeOnClick className="py-2"><span className={styles.actionOption}><span>{action.label}</span>{action.description&&<span>{action.description}</span>}</span></DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      </ButtonGroup>
    </div></header>
    <div className={styles.runSummary}><span className={styles.runStatus} data-state={status} role="status"><span className={styles.runStatusDot} aria-hidden="true"/>{statusText}</span><span>{t("automationUi.stepCount", { count: nodes.length })}</span>{run && <><span>{t("automationUi.completedSteps", { count: completed })}</span><time>{new Date(run.startedAt).toLocaleString(locale)}</time></>}{waiting && <Button variant="ghost" size="sm" onClick={() => {setAssistanceOpen(true); setDetailsOpen(false);}}><CircleHelpIcon size={14}/>{t("automationUi.needsInput")}</Button>}</div>
    <NotificationNotice message={active ? error : undefined} type="error" eventKey={`automation-operation:${noticeScope}:${runId ?? "idle"}:${error}`} />
    <AutomationRunSplit ownerKey={index.ownerKey} preferenceScope={authoringPreview?"preview":"application"}>
      <Card className={styles.workflowPanel}><div className={styles.panelHeader}><h3>{t("automationUi.workflow")}{actionOptions.length > 1 ? ` · ${detail.ui.buttons[0]?.label ?? ""}` : ""}</h3><Button variant="ghost" size="sm" aria-pressed={follow} onClick={() => {followRef.current = !follow; setFollow(!follow);}}><LocateFixedIcon size={14}/>{follow ? t("automationUi.follow") : t("automationUi.resumeFollow")}</Button></div>
        <div className={styles.canvasScroll} ref={canvasScrollRef}><div ref={canvasRef} className={styles.canvas}>
          {geometry.width > 0 && <svg className={styles.edges} width={geometry.width} height={geometry.height} aria-hidden="true">{geometry.paths.map((edge, i) => <path key={i} d={edge.d} />)}</svg>}
          {nodes.map((node, i) => { const events = run?.events.filter(event => event.kind === "node" && event.nodeId === node.id) ?? [], last = events.at(-1), count = events.filter(event => event.status === "running").length;
            const status = last?.status === "running" && run && !appRunActive(run.status) ? "interrupted" : waiting && last?.status === "running" ? "waiting-user" : last?.status ?? "idle";
            return <Button variant="outline" key={node.id} className={styles.node} data-node-id={node.id} data-status={status} data-selected={selectedNode === node.id} onClick={() => {followRef.current = false;setFollow(false);setSelectedNode(node.id);setSelectedEvent(last ?? null);setDetailsOpen(true);setAssistanceOpen(false);}}><span className={styles.nodeTitle}><WorkflowIcon size={15}/>{node.label}</span><span className={styles.nodeStatus}>{statusNames[status] ?? status}<span>{count > 1 ? t("automationUi.iteration", { count }) : String(i + 1).padStart(2,"0")}</span></span></Button>;
          })}
          {!nodes.length && <div className={styles.empty}>{t("automationUi.noWorkflow")}</div>}
        </div></div>
        {detailsOpen && focusedNode && <Card className={styles.inspector} aria-label={t("automationUi.stepDetails")}><div className={styles.panelHeader}><h3>{focusedNode.label}</h3><Button size="icon" variant="ghost" aria-label={t("automationUi.closeStepDetails")} onClick={() => setDetailsOpen(false)}><XIcon size={15}/></Button></div><div className={styles.inspectorBody}>
          <p className={styles.muted}>{selectedEvent ? statusNames[selectedEvent.status] ?? selectedEvent.status : t("automationUi.notRun")}{selectedEvent?.execution ? t("automationUi.executionSuffix", { execution: selectedEvent.execution }) : ""}</p>
          {selectedEvent && <div className={styles.eventPicker}><label htmlFor={`execution-${focusedNode.id}`}>{t("automationUi.executionHistory")}</label><Select value={String(selectedEvent.seq)} items={run?.events.filter(event => event.kind === "node" && event.nodeId === focusedNode.id).map(event => ({value:String(event.seq),label:t("automationUi.executionStatus", { execution: event.execution ?? "—", status: statusNames[event.status] ?? event.status })}))} onValueChange={value => {if(value===null)return;const event = run?.events.find(item => item.seq === Number(value));if(event)selectEvent(event);}}><SelectTrigger id={`execution-${focusedNode.id}`}><SelectValue /></SelectTrigger><SelectContent>{run?.events.filter(event => event.kind === "node" && event.nodeId === focusedNode.id).map(event => <SelectItem key={event.seq} value={String(event.seq)}>{t("automationUi.executionPrefix")}{event.execution} · {statusNames[event.status] ?? event.status}</SelectItem>)}</SelectContent></Select></div>}
          <Tabs value={detailTab} onValueChange={setDetailTab}><TabsList><TabsTrigger value="input">{t("automationUi.input")}</TabsTrigger><TabsTrigger value="output">{t("automationUi.output")}</TabsTrigger></TabsList><TabsContent value="input"><pre className={styles.json}>{io.input === undefined ? t("automationUi.noInput") : JSON.stringify(io.input,null,2)}</pre></TabsContent><TabsContent value="output"><pre className={styles.json}>{io.output === undefined ? t("automationUi.noOutput") : JSON.stringify(io.output,null,2)}</pre></TabsContent></Tabs>
        </div></Card>}
        {assistanceOpen && waiting && <Card className={styles.assistance} aria-label={t("automationUi.assistance")}><div className={styles.panelHeader}><h3>{t("automationUi.needsInput")}</h3><Button variant="ghost" size="icon" onClick={() => setAssistanceOpen(false)} aria-label={t("automationUi.collapseAssistance")}><XIcon size={15}/></Button></div><div className={styles.assistanceBody}>{requests}</div></Card>}
      </Card>
      <Card className={styles.dataPanel}><Tabs className={styles.dataTabs} value={dataTab} onValueChange={value => {dataTabTouched.current = true; setDataTab(value);}}><div className={styles.panelHeader}><TabsList><TabsTrigger value="results">{t("automationUi.results")}{rows?.length ?? 0}</TabsTrigger><TabsTrigger value="logs">{t("automationUi.logs")}{run?.events.length ?? 0}</TabsTrigger></TabsList>{downloadMenu}</div><TabsContent className={styles.resultPane} value="results">{resultBody}</TabsContent><TabsContent className={styles.logPane} value="logs"><div ref={logsRef} className={styles.logScroll} onScroll={() => {const el = logsRef.current;if(el)logFollow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;}}>{run?.events.length ? run.events.map(event => <Button variant="ghost" key={event.seq} className={styles.logLine} onClick={() => {if(event.kind === "node")selectEvent(event);}}><time>{new Date(event.at).toLocaleTimeString(locale)}</time><span>{event.nodeId ? nodes.find(node => node.id === event.nodeId)?.label : t("automationUi.run")} · {statusNames[event.status] ?? event.status}{event.execution ? ` #${event.execution}` : ""}{event.message ? ` · ${event.message}` : ""}</span></Button>) : <div className={styles.empty}>{t("automationUi.noLogs")}</div>}</div></TabsContent></Tabs></Card>
    </AutomationRunSplit>
    <Dialog open={configOpen} onOpenChange={setConfigOpen}><DialogContent><DialogHeader><DialogTitle>{t("automationUi.runConfig")}{actionOptions.length > 1 ? ` · ${detail.ui.buttons[0]?.label ?? ""}` : ""}</DialogTitle></DialogHeader><DialogBody><Tabs value={configTab} onValueChange={setConfigTab}><TabsList><TabsTrigger value="parameters">{t("automationUi.parameterTab")}</TabsTrigger>{Boolean(detail.manifest.automation.browser?.sites.length) && <TabsTrigger value="browser">{t("automationUi.browserConfig")}</TabsTrigger>}</TabsList><TabsContent value="parameters">{fieldsForm}</TabsContent><TabsContent value="browser"><AutomationApplicationBrowser view="settings" detail={detail} index={index} run={run} running={running} active={active && configOpen} taskId={taskId}/></TabsContent></Tabs></DialogBody><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfigOpen(false)}>{t("automationUi.close")}</Button>{configTab === "parameters" && <Button disabled={locked} onClick={() => void save()}>{t("automationUi.saveConfig")}</Button>}</DialogFooter></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent><DialogHeader><DialogTitle>{t("automationUi.history")}</DialogTitle></DialogHeader><DialogBody><div className={styles.historyList}>{history.map(item => <Button variant="outline" key={item.id} data-selected={item.id === runId} aria-current={item.id === runId ? "true" : undefined} disabled={busy || running || retryStart || !active} onClick={() => {setRunId(item.id);setHistoryOpen(false);followRef.current=true;setFollow(true);}}><span>{new Date(item.startedAt).toLocaleString(locale)}</span><span className={styles.historyStatus}>{item.id === runId && <CheckIcon size={14} aria-hidden="true" />}<span className={styles.runStatus} data-state={item.status}>{statusNames[item.status]}</span></span></Button>)}{!history.length && <p className={styles.muted}>{t("automationUi.noHistory")}</p>}</div></DialogBody></DialogContent></Dialog>
  </section>;
});
