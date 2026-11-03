"use client";
import { useEffect,useState,type RefObject } from "react";
import { AutomationAppBrowserBridge } from "./AutomationAppBrowserBridge";
import type { AutomationBrowserControls,AutomationTaskState } from "@/lib/automation-task-state";
import type { NativeBrowserSpec } from "@/lib/native-browser";
interface State {sessionId:string;taskId?:string;ownerKey:string;runtimeId:string;appId:string|null;runId?:string;active:boolean}
export function AutomationAuthoringBrowserHost(props:{active:boolean;sessionId:string|null;controls:RefObject<AutomationBrowserControls|null>;nativeSpec:NativeBrowserSpec|null;visible:boolean;taskState:AutomationTaskState;onOpenBrowser:(id:string,native?:NativeBrowserSpec)=>void}){
  const [state,setState]=useState<State|null>(null);
  const [chat,setChat]=useState<State|null>(null);
  useEffect(()=>{const listener=(event:Event)=>{const value=(event as CustomEvent<State|null>).detail;if(value?.sessionId===props.sessionId)setChat(value);};window.addEventListener("eureka:chat-automation-state",listener);return()=>window.removeEventListener("eureka:chat-automation-state",listener);},[props.sessionId]);
  useEffect(()=>{const listener=(event:Event)=>{const value=(event as CustomEvent<State|null>).detail;if(!value||value.sessionId!==props.sessionId)return;setState(value);};window.addEventListener("eureka:authoring-state",listener);return()=>window.removeEventListener("eureka:authoring-state",listener);},[props.sessionId]);
  const current=chat?.sessionId===props.sessionId&&chat.active?chat:state?.sessionId===props.sessionId&&state.active?state:chat?.sessionId===props.sessionId?chat:state;
  if(!current||current.sessionId!==props.sessionId)return null;
  return <AutomationAppBrowserBridge active={props.active&&current.active} appId={current.appId} runId={current.runId} taskId={current.taskId} ownerKey={current.ownerKey} runtimeId={current.runtimeId} browserControls={props.controls} nativeSpec={props.nativeSpec} nativeVisible={props.visible} taskState={props.taskState} onOpenBrowser={props.onOpenBrowser}/>;
}
