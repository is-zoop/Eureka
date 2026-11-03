import type { AutomationTaskRef } from "./automation-mode";
import { appRunActive, type AppJson, type AppRunRecord } from "./automation-app-run";
import type { AutomationAppDetail } from "./automation-app";
export interface AuthorCheck {source:"result"|"artifact"|"file";path?:string;name?:string;fieldId?:string;relative?:string;format?:"text"|"json";expected?:AppJson;evidenceId?:string;evidencePath?:string}
export interface AuthorFinding {label:string;equal:boolean;reason?:"missing-check"|"missing-field"|"value-mismatch"|"missing-evidence"|"read-error";hint?:string;rows?:number[]}
export interface AuthorCandidate {id:string;digest:string;revision:number;scope:string[];limitations:string[];checks:AuthorCheck[];runId?:string;lastError?:string;saveIntent?:{digest:string;revision:number;publishedDigest?:string;displayName?:string};validation?:{status:"passed"|"failed";runId:string;digest:string;at:string;checks:AuthorFinding[]};saved?:{id:string;version:string;at:string;displayName?:string}}
export interface AuthorState {schemaVersion:1;candidate?:AuthorCandidate;explorer?:{run:AppRunRecord;detail:AutomationAppDetail};evidenceCursor?:{runId:string;seq:number};evidenceWarnings?:string[];evidence:{id:string;method:string;at:string;value:AppJson;runId?:string;digest?:string;context?:AppJson}[]}
export interface AuthorSnapshot {task:AutomationTaskRef;sessionId:string;active:boolean;goal:string;state:AuthorState;detail?:AutomationAppDetail;run?:AppRunRecord;ownerKey:string;runtimeId:string}
/** Completed trials never take the transport away from a new exploration. */
export function authorBrowserTarget(snapshot: AuthorSnapshot): {appId:string;runId:string} | null {
  if (!snapshot.active || snapshot.state.candidate?.saved) return null;
  const candidate = snapshot.state.candidate;
  if (candidate?.runId && snapshot.run?.id === candidate.runId && appRunActive(snapshot.run.status)) return {appId:candidate.id,runId:candidate.runId};
  const explorer = snapshot.state.explorer;
  return explorer && appRunActive(explorer.run.status) ? {appId:explorer.detail.install.id,runId:explorer.run.id} : null;
}
export function authorValueAt(value:unknown,path=""):unknown {
  if(path==="")return value;if(!path.startsWith("/")||path.length>2000||/~(?![01])/.test(path))throw new Error("字段路径使用 JSON Pointer，例如 /0/name。");
  let current=value;for(const key of path.slice(1).split("/").map(k=>k.replace(/~1/g,"/").replace(/~0/g,"~"))){if(!current||typeof current!=="object"||!Object.hasOwn(current,key))throw new Error("校验字段缺失，不能按零或空值比较。");current=(current as Record<string,unknown>)[key];}return current;
}
export function authorEqual(a:unknown,b:unknown):boolean {if(a===b)return true;if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;const x=Object.keys(a),y=Object.keys(b);return x.length===y.length&&x.every(k=>Object.hasOwn(b,k)&&authorEqual((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));}
