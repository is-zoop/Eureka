/** Read-only compatibility for archived creation conversations; no executable tools. */
export const CREATION_ENTRY="eureka_automation_creation";
export interface CreationBinding {version:1;ownerKey:string;runtimeId:string}
export function creationBinding(entries:readonly {type:string;customType?:string;data?:unknown}[]):CreationBinding|null{
  for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(e.type!=="custom"||e.customType!==CREATION_ENTRY)continue;const v=e.data as CreationBinding|undefined;
    if(v?.version===1&&/^[a-f0-9]{64}$/.test(v.ownerKey)&&typeof v.runtimeId==="string"&&v.runtimeId)return {version:1,ownerKey:v.ownerKey,runtimeId:v.runtimeId};
  }return null;
}
