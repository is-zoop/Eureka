import type { AutomationAppAction, AutomationAppDetail } from "./automation-app";
export class AppActionSelectionError extends Error {}

/** Pure shared selection: old button-based packages keep their original behavior. */
export function appActions(detail: Pick<AutomationAppDetail, "actions" | "ui" | "workflow" | "manifest">): AutomationAppAction[] {
  return detail.actions?.length ? detail.actions : detail.ui.buttons.map(button => ({
    id: button.id, label: button.label, entry: detail.manifest.automation.entry,
    ui: detail.manifest.automation.ui, workflow: detail.manifest.automation.workflow,
    definition: { ...detail.ui, buttons: [button] }, graph: detail.workflow,
  }));
}
export function appActionDetail<T extends Pick<AutomationAppDetail,"actions"|"ui"|"workflow"|"manifest"> & {actionId?:string}>(detail: T, actionId?: string) {
  const action = appActions(detail).find(item => item.id === (actionId ?? detail.actionId ?? appActions(detail)[0]?.id));
  if (!action) throw new AppActionSelectionError("所选功能不存在，请重新读取应用。");
  return { ...detail, actions: appActions(detail), actionId: action.id, ui: action.definition, workflow: action.graph,
    manifest: { ...detail.manifest, automation: { ...detail.manifest.automation, entry: action.entry,
      capabilities: action.capabilities ?? detail.manifest.automation.capabilities } } };
}
export function appActionConfigurationScope(detail: AutomationAppDetail): string | undefined {
  return detail.manifest.automation.actions?.length ? detail.actionId ?? detail.manifest.automation.actions[0].id : undefined;
}
export function appActionSummaries(detail: Parameters<typeof appActions>[0]) {
  return appActions(detail).map(action => ({ id: action.id, label: action.label, description: action.description,
    parameters: action.definition.fields, results: action.definition.results, workflow: action.graph }));
}
