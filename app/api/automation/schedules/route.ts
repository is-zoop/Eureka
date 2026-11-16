import { appFailure, appJson, automationAppAccess, readAppRequest } from "@/lib/automation-app-server";
import { createSchedule, changeSchedule, listSchedules, scheduleRuns, startAutomationScheduler } from "@/lib/automation-scheduler";
import { AutomationAppError } from "@/lib/automation-app-package";
import { hasJsonContentType } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const auth = await automationAppAccess(request); startAutomationScheduler(); const plans = await listSchedules(auth, new URL(request.url).searchParams.get("appId") ?? undefined); return appJson({ plans: await scheduleRuns(auth, plans) }); } catch (error) { return appFailure(error); }
}
export async function POST(request: Request) {
  try {
    if (!hasJsonContentType(request)) throw new AutomationAppError("请求格式无效", 400);
    const body = JSON.parse((await readAppRequest(request, 512 * 1024)).toString("utf8")), auth = await automationAppAccess(request, body);
    if (body.action === "create") { const plan = await createSchedule(auth, body.plan); startAutomationScheduler(); return appJson(plan); }
    if (["pause", "enable", "delete"].includes(body.action)) return appJson(await changeSchedule(auth, body.id, body.revision, body.action));
    throw new AutomationAppError("定时操作无效", 400);
  } catch (error) { return appFailure(error); }
}
