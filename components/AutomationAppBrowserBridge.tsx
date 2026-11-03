"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, type RefObject } from "react";
import type { AutomationBrowserControls, AutomationTaskState } from "@/lib/automation-task-state";
import { isDesktopBrowserHost, nativeBrowserCommand, sameNativeBrowser, type NativeBrowserSpec } from "@/lib/native-browser";

type Props = { active:boolean;appId:string|null;runId?:string;ownerKey:string;runtimeId:string;taskId?:string;nativeSpec?:NativeBrowserSpec|null;nativeVisible?:boolean;taskState?:AutomationTaskState;browserControls?:RefObject<AutomationBrowserControls|null>;onOpenBrowser:(id:string,native?:NativeBrowserSpec)=>void };
type Command = { id:string;method:string;payload:string;native:NativeBrowserSpec;expiresAt:number };

/** Presentation may detach; only an explicit stop cancels the server run. */

export function AutomationAppBrowserBridge(props:Props) {
  const { t: translate } = useI18n();
  const translation = useRef(translate); translation.current = translate;
  const latest=useRef(props);latest.current=props;
  useEffect(()=>{
    if(!props.active||!props.appId||!props.ownerKey||!props.runtimeId)return;
    const t = (key: string) => translation.current(key);
    const bridgeId=crypto.randomUUID(),endpoint=`/api/automation/apps/${props.appId}/browser`;
    let disposed=false,stopped=false,busy=false,controlled=false,presentationReady=true;
    let runId:string|null=null,commandId="",native:NativeBrowserSpec|null=null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    async function post(mode:string,extra:Record<string,unknown>={},keepalive=false){
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,ownerKey:props.ownerKey,runtimeId:props.runtimeId,taskId:props.taskId,runId,bridgeId,...extra}),keepalive,signal:keepalive?undefined:AbortSignal.timeout(15000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error??t("automationUi.bridgeUnavailable"));return data;
    }
    function pause(){controlled=false;if(native&&sameNativeBrowser(latest.current.nativeSpec,native))void latest.current.browserControls?.current?.pauseAutomation().catch(()=>{});}
    function detach(){pause();if(runId)void post("detach",{},true).catch(()=>{});}
    function check(){if(disposed||stopped||!latest.current.active)throw new Error(t("automationUi.bridgeLeft"));}
    function available(){const current=latest.current;return Boolean(native&&sameNativeBrowser(current.nativeSpec,native)&&current.nativeVisible&&current.taskState?.phase==="manual"&&current.browserControls?.current&&presentationReady&&document.visibilityState!=="hidden");}
    async function ready(spec:NativeBrowserSpec,valid:()=>void){
      for(;;){valid();if(sameNativeBrowser(native,spec)&&available())return latest.current.browserControls!.current!;await new Promise(resolve=>setTimeout(resolve,150));}
    }
    async function execute(id:string){
      busy=true;commandId=id;let lease="";
      const executingRun=runId,send=(mode:string,extra:Record<string,unknown>)=>post(mode,{...extra,runId:executingRun});
      const valid=()=>{check();if(runId!==executingRun)throw new Error(t("automationUi.runEnded"));};
      try{
        valid();const claimed=await send("claim",{commandId:id});lease=claimed.lease;valid();
        const command=claimed.command as Command,spec=command.native;native=spec;
        if(!isDesktopBrowserHost())throw new Error(t("automationUi.desktopRequired"));
        if(command.method==="open"){
          await ready(spec,valid);valid();await send("complete",{commandId:id,lease,result:{opened:true}});
        }else if(command.method==="release"){
          pause();valid();await send("complete",{commandId:id,lease,result:{released:true}});
        }else{
          const controls=await ready(spec,valid);valid();
          if(command.method!=="probe"&&!controlled){if(!controls.claimApplication)throw new Error(t("automationUi.desktopUpdate"));await controls.claimApplication();controlled=true;}
          valid();const {ticket}=await send("arm",{commandId:id,lease});valid();
          if(!controls.applicationRequest)throw new Error(t("automationUi.desktopUpdate"));
          const result=await controls.applicationRequest(command.payload,ticket);
          // Reporting a result after detach cannot dispatch another action.
          // The server still rejects an expired or replaced execution lease.
          await send("complete",{commandId:id,lease,result});
        }
      }catch(error){
        pause();
        if(error instanceof TypeError||error instanceof Error&&["TimeoutError","AbortError"].includes(error.name))detach();
        else if(lease&&!disposed){
          const message=error instanceof Error?error.message:String(error);
          if(!available()||/请先关闭当前菜单或弹窗|网页控制已暂停|observationUnavailable|staleControl/.test(message)){
            const deferred=await send("defer",{commandId:id,lease}).catch(()=>null);
            if(deferred?.deferred)return;
          }
          await send("complete",{commandId:id,lease,error:message}).catch(()=>{});
        }
      }finally{busy=false;commandId="";}
    }
    async function poll(){
      if(disposed||stopped)return;
      try{
        const params=new URLSearchParams({mode:"commands",bridgeId,ownerKey:props.ownerKey,runtimeId:props.runtimeId,available:String(available()),...(props.taskId?{taskId:props.taskId}:{}),...(props.runId?{runId:props.runId}:{}),...(commandId?{commandId}:{})});
        const response=await fetch(`${endpoint}?${params}`,{cache:"no-store",signal:AbortSignal.timeout(4000)});
        const data=await response.json();if(!response.ok)throw new Error(data.error);check();
        if(runId!==data.runId){pause();runId=data.runId??null;native=null;presentationReady=true;}
        if(runId&&data.owned!==false){
          const spec=data.native as NativeBrowserSpec|undefined;
          if(spec&&!sameNativeBrowser(latest.current.nativeSpec,spec)){
            native=spec;
            if(!isDesktopBrowserHost()){await post("connection-failed",{reason:"desktop-required"});stopped=true;return;}
            if(data.hasOpened){const snapshot=await nativeBrowserCommand(spec,"status");check();if(!snapshot.opened){await post("connection-failed");stopped=true;return;}}
            check();latest.current.onOpenBrowser(spec.sessionId,spec);
          }else if(spec)native=spec;
          if(!busy&&data.command&&available())void execute(data.command.id);
        }
      }catch{/* A transport failure is not a request to stop the conversation. */}
      if(!disposed&&!stopped)timer=setTimeout(()=>void poll(),400);
    }
    const manual=(event:Event)=>{const scope=(event as CustomEvent<{taskId?:string;runId?:string;sessionId?:string}>).detail;if(scope?.taskId&&scope.taskId!==props.taskId||scope?.runId&&scope.runId!==runId||scope?.sessionId&&!props.taskId)return;stopped=true;pause();if(runId)void post("leave",{},true).catch(()=>{});};
    const availability=(event:Event)=>{const value=(event as CustomEvent<{spec:NativeBrowserSpec;available:boolean}>).detail;if(value&&sameNativeBrowser(value.spec,native)){presentationReady=value.available;if(!value.available)controlled=false;}};
    const pagehide=()=>detach();
    window.addEventListener("eureka:automation-pause",manual);window.addEventListener("eureka:automation-browser-availability",availability);window.addEventListener("pagehide",pagehide);void poll();
    return()=>{disposed=true;if(timer)clearTimeout(timer);window.removeEventListener("eureka:automation-pause",manual);window.removeEventListener("eureka:automation-browser-availability",availability);window.removeEventListener("pagehide",pagehide);detach();};
  },[props.active,props.appId,props.runId,props.ownerKey,props.runtimeId,props.taskId]);
  return null;
}
