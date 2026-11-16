import { readRuntimeHazeSession } from "./auth/runtime-session";
import { localAutomationContext } from "./automation-local-context";
import { LOCAL_AUTOMATION_SOURCE, requiresCloudPluginSelection, type SelectedPlugin } from "./plugin-selection";

type Owner = { source: string; subject: string };

/** Local-only automation requests retain their owner through cloud login changes. */
export function automationTaskOwner(creating: boolean, plugins: SelectedPlugin[]): Owner | undefined {
  if (creating || plugins.length > 0 && !requiresCloudPluginSelection(plugins)) {
    const local = localAutomationContext();
    return { source: LOCAL_AUTOMATION_SOURCE, subject: local.workspaceId };
  }
  const identity = readRuntimeHazeSession();
  return identity ? { source: process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "") ?? "", subject: identity.principal.subject } : undefined;
}

export function assertAutomationTaskOwner(owner: Owner | undefined): void {
  if (!owner) return;
  if (owner.source === LOCAL_AUTOMATION_SOURCE) {
    const local = localAutomationContext();
    if (owner.subject !== local.workspaceId) throw new Error("本地自动化工作区已变化，请重新打开任务。");
    local.assertIdentity();
    return;
  }
  const identity = readRuntimeHazeSession();
  if (!identity || owner.source !== process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "") || owner.subject !== identity.principal.subject) {
    throw new Error("当前云端身份已变化，请重新调用插件；澄清回答已保留。");
  }
}
