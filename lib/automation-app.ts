/** Public application contracts. No credentials or per-user configuration belong here. */
export const AUTOMATION_APP_SCHEMA = 1;
export const APP_CAPABILITIES = ["files.read", "files.write", "browser.read", "browser.write", "ai", "clarification", "artifacts"] as const;
export type AppCapability = typeof APP_CAPABILITIES[number];
export interface AutomationAppDeclaration {
  schemaVersion: 1;
  id: string;
  runtime: "javascript-esm";
  entry: string;
  ui: "ui.json";
  workflow: "workflow.json";
  capabilities: AppCapability[];
  files: string[];
  actions?: AutomationAppActionDeclaration[];
  browser?: import("./automation-app-browser").AppBrowserDeclaration;
}
export interface AutomationAppActionDeclaration {
  id: string; label: string; description?: string; entry: string; ui: string; workflow: string;
  capabilities?: AppCapability[];
}
export interface AutomationAppAction extends AutomationAppActionDeclaration {
  definition: AutomationAppUi; graph: AutomationAppWorkflow;
}
export interface AutomationAppManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  automation: AutomationAppDeclaration;
}
export type AppValueType = "text" | "number" | "boolean" | "date" | "percentage" | "object" | "list";
export interface AutomationAppUi {
  schemaVersion: 1;
  fields: { id: string; label: string; type: AppValueType | "file" | "directory"; required?: boolean; description?: string; default?: unknown; multiline?:boolean }[];
  buttons: { id: string; label: string; action: "run" }[];
  results: { columns: { key: string; label: string; type: AppValueType }[]; download?: boolean };
}
export interface AutomationAppWorkflow {
  schemaVersion: 1;
  nodes: { id: string; label: string; kind: "script" | "browser" | "ai" | "branch" | "loop" | "wait-user"; script?: string; description?: string }[];
  edges: { from: string; to: string; label?: string; when?: string }[];
}
export interface AutomationAppVersion { version: string; digest: string; installedAt: string }
export interface ManagedAutomationPlugin {source:string;capabilityId:string;locations:{scope:"global"|"project";cwd:string}[]}
export interface AutomationAppPresentation {
  revision: string;
  description: string;
  categoryId: number | null;
  tags: string[];
  icon?: { digest: string; mimeType: "image/png" | "image/jpeg" | "image/webp" };
}
export interface AutomationAppEditValues {
  displayName: string; description: string; categoryId: number | null; tags: string[];
  icon?: { name: string; type: string; data: string } | null;
}
export interface AutomationAppEditView extends AutomationAppEditValues {
  ownerKey: string; runtimeId: string; revision: number; categories: { id: number; name: string }[];
}
export interface AutomationAppInstall {
  id: string;
  name: string;
  displayName: string;
  activeVersion: string;
  disabled: boolean;
  revision: number;
  installedAt: string;
  updatedAt: string;
  versions: AutomationAppVersion[];
  managedPlugin?:ManagedAutomationPlugin;
  presentation?: AutomationAppPresentation;
}
export interface AutomationAppSummary extends AutomationAppInstall { error?: string; description?: string; capabilities?: AppCapability[] }
export interface AutomationAppData { id: string; displayName: string; installed: boolean }
export interface AutomationAppIndex { ownerKey: string; runtimeId: string; apps: AutomationAppSummary[]; data: AutomationAppData[] }
export interface AutomationAppDetail {
  install: AutomationAppInstall;
  manifest: AutomationAppManifest;
  ui: AutomationAppUi;
  workflow: AutomationAppWorkflow;
  files: string[];
  readme: string;
  codeDirectory: string;
  dataDirectory: string;
  workspaceDirectory?: string;
  actions?: AutomationAppAction[];
  /** Resolved execution/configuration scope; absent on an unselected package. */
  actionId?: string;
}
export const isAppId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
export const isAppVersion = (value: unknown): value is string => typeof value === "string" && value.length < 80 && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(value);
