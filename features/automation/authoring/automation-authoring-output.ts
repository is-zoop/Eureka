import { authorValueAt } from "./automation-authoring-types";

/** This budget applies to model-visible previews, never execution data. */
export const AUTHOR_MODEL_VALUE_BYTES = 20_000;
const fits = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) <= AUTHOR_MODEL_VALUE_BYTES;
function shape(value: unknown, depth = 0, budget={left:80}): unknown {
  if(--budget.left<0)return {omitted:true};
  if (Array.isArray(value)) return {type:"array",length:value.length,...(value.length&&depth<3?{item:shape(value[0],depth+1,budget)}:{})};
  if (value && typeof value === "object") return {type:"object",fields:Object.fromEntries(Object.entries(value).slice(0,24).map(([k,v])=>[k,depth<3?shape(v,depth+1,budget):Array.isArray(v)?"array":typeof v])),fieldCount:Object.keys(value).length};
  return {type:value===null?"null":typeof value,...(typeof value==="string"?{length:value.length}:{})};
}
export interface AuthorValuePage {path?:string;offset?:number;limit?:number;fields?:string[]}
export function authorValuePage(value:unknown, ref:string, options:AuthorValuePage={}) {
  const selected=authorValueAt(value,options.path??"");
  const offset=options.offset??0,limit=options.limit??5;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error("读取分页无效。");
  if(options.fields&&(!Array.isArray(options.fields)||options.fields.length>32||options.fields.some(k=>typeof k!=="string"||k.length>200)))throw new Error("读取字段无效。");
  const project=(v:unknown)=>options.fields&&v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(options.fields.filter(k=>Object.hasOwn(v,k)).map(k=>[k,(v as Record<string,unknown>)[k]])):v;
  if(Array.isArray(selected)){
    let count=Math.min(limit,Math.max(0,selected.length-offset));
    while(count>0){const values=selected.slice(offset,offset+count).map(project);if(fits(values))return {valueRef:ref,path:options.path??"",values,total:selected.length,nextOffset:offset+count<selected.length?offset+count:null};count=Math.floor(count/2);}
    if(!selected.length||offset>=selected.length)return {valueRef:ref,values:[],total:selected.length,nextOffset:null};
  }else if(typeof selected==="string"){
    const count=Math.min(limit*200,4000);return {valueRef:ref,path:options.path??"",text:selected.slice(offset,offset+count),total:selected.length,nextOffset:offset+count<selected.length?offset+count:null};
  }else{const projected=project(selected);if(fits(projected))return {valueRef:ref,value:projected};}
  const preview=shape(selected);
  return {valueRef:ref,path:options.path??"",shape:fits(preview)?preview:{type:Array.isArray(selected)?"array":typeof selected},omitted:true,message:"完整内容留在任务内；使用 evidenceId、path、fields 和 offset/limit 读取所需字段。"};
}
