import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { automationAccess, DraftIdentityError } from "./automation-access";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { AutomationAppError } from "./automation-app-package";
import { AutomationAppStore } from "./automation-app-store";
import { isApiRequestAllowed } from "./request-security";
import { assertManagedAutomationEnabled,managedAutomationState } from "./automation-managed-source";

export const appJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function automationAppAccess(request: Request, expected?: { ownerKey?: unknown; runtimeId?: unknown }) {
  if (!isApiRequestAllowed(request)) throw new AutomationAppError("请求来源无效", 403);
  const auth = await automationAccess(), runtimeId = readRuntimeHazeSession()?.runtimeId;
  if (!runtimeId) throw new DraftIdentityError();
  if (expected && (expected.ownerKey !== auth.ownerKey || expected.runtimeId !== runtimeId)) throw new AutomationAppError("登录身份已变化，请刷新应用目录后重试", 409);
  const store=new AutomationAppStore(getAgentDir(),auth.ownerKey,auth.assertIdentity),appId=new URL(request.url).pathname.match(/^\/api\/automation\/apps\/([a-f0-9-]{36})(?:\/|$)/)?.[1],install=appId?await store.find(appId):null;
  const location=appId&&install?.managedPlugin?managedAutomationState(appId,install.managedPlugin).selected?.location:undefined;
  // Pin the granting installation, not its version: an update may finish an
  // old run, but disabling that particular installation revokes its execution.
  const executionSource=install?.managedPlugin?{...install.managedPlugin,...(location?{locations:[location]}:{})}:undefined;
  return { ...auth, runtimeId, store,assertExecution:()=>{auth.assertIdentity();if(appId&&executionSource)assertManagedAutomationEnabled(appId,executionSource);} };
}
export async function applicationAccess(request:Request,expected?:{ownerKey?:unknown;runtimeId?:unknown;taskId?:unknown}) {
  const taskId=expected?.taskId??new URL(request.url).searchParams.get("taskId");
  if(!taskId)return automationAppAccess(request,expected);
  if(!isApiRequestAllowed(request)||typeof taskId!=="string"||!/^[a-f0-9-]{36}$/.test(taskId))throw new AutomationAppError("创建任务引用无效",403);
  return (await import("./automation-authoring")).authorRequestAccess(request,taskId,expected);
}
export async function readAppRequest(request: Request, limit: number): Promise<Buffer> {
  const reader = request.body?.getReader(); if (!reader) throw new AutomationAppError("请求内容为空");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new AutomationAppError("请求内容超过大小限制", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function appFailure(error: unknown) {
  if (error instanceof DraftIdentityError) return appJson({ error: "请先登录 Haze，再管理自己的应用包。" }, 401);
  if (error instanceof AutomationAppError) return appJson({ error: error.message }, error.status);
  return appJson({ error: "应用包存储暂时不可用，请检查文件是否被占用，刷新后重试。" }, 500);
}
export function appDownload(bytes: Buffer, filename: string) {
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
