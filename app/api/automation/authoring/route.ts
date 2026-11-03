import { appJson,appFailure,readAppRequest } from "@/lib/automation-app-server";
import { isApiRequestAllowed,hasJsonContentType } from "@/lib/request-security";
import { authorFromSession,authorSnapshot,saveAuthor,stopAuthor,readAuthor } from "@/lib/automation-authoring";
import { AutomationAppError } from "@/lib/automation-app-package";
import { getRpcSession } from "@/lib/rpc-manager";
import { changeAutomationTask } from "@/lib/automation-mode-store";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { validateUserInputResponse } from "@/lib/user-input";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{if(!isApiRequestAllowed(request))throw new AutomationAppError("来源无效",403);const sid=new URL(request.url).searchParams.get("sessionId");if(!sid||!/^[a-f0-9-]{36}$/.test(sid))return appJson(null);const a=await authorFromSession(sid,true);return appJson(a?await authorSnapshot(a):null);}catch(e){return appFailure(e);}}
export async function POST(request:Request){try{
  if(!isApiRequestAllowed(request)||!hasJsonContentType(request))throw new AutomationAppError("来源无效",403);
  const body=JSON.parse((await readAppRequest(request,64000)).toString("utf8")),a=await authorFromSession(body.sessionId,body.mode==="save");if(!a||body.taskId!==a.taskId||body.ownerKey!==a.ownerKey||body.runtimeId!==a.runtimeId)throw new AutomationAppError("创建任务或登录已变化",409);
  if(body.mode==="save"){const state=await readAuthor(a);if(state.candidate?.saved&&state.candidate.digest===body.digest)return appJson(state.candidate.saved);}
  if(body.mode==="save") {const saved=await saveAuthor(a.task,body.digest,body.displayName),live=getRpcSession(a.doc.sessionId);if(live?.isAlive())await live.send({type:"exit_automation_task",automationTask:a.task});else{const file=await resolveSessionPath(a.doc.sessionId);if(file)await changeAutomationTask(SessionManager.open(file),a.task,"exited");}return appJson(saved);}
  if(body.mode==="stop"){await stopAuthor(a.task);return appJson({ok:true});}
  if(body.mode==="login") {const s=await readAuthor(a),q=s.explorer?.run.question,waiter=a.actor.login;if(!q||!waiter||q.id!==body.questionId||!Array.isArray(body.responses)||body.responses.length!==q.questions.length)throw new AutomationAppError("登录问题已变化",409);for(const question of q.questions){const answer=body.responses.find((r:{questionId:string})=>r.questionId===question.id);if(!answer)throw new AutomationAppError("请回答当前问题");const v=validateUserInputResponse(question,answer);if(!v.optionIds?.includes("1"))throw new AutomationAppError("请完成登录后选择继续，或停止任务。");}delete s.explorer!.run.question;s.explorer!.run.status="running";await a.host.privateJson(a.directory+"/author.json",s);a.actor.login=undefined;waiter.resolve();return appJson({ok:true});}
  throw new AutomationAppError("创建操作无效");
}catch(e){return appFailure(e);}}
