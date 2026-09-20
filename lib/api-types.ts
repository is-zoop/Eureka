import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

export type McpConfigScope = "project" | "global";
export type McpLifecycle = "lazy" | "eager" | "keep-alive";
export type McpTransportKind = "stdio" | "http";
export type McpServerRuntimeState = "connected" | "cached" | "failed" | "needs-auth" | "not-connected" | "disabled" | "unknown";

export interface McpServerInput {
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  bearerTokenEnv?: string;
  lifecycle?: McpLifecycle;
  idleTimeout?: number;
  /** Disabled servers stay configured but are not loaded into new sessions. */
  disabled?: boolean;
}

export interface McpServerSummary extends McpServerInput {
  scope: McpConfigScope;
  state: McpServerRuntimeState;
  toolCount: number;
  error?: string;
}

export interface McpRuntimeStatus {
  sessionId: string;
  updatedAt: string;
  servers: Array<{ name: string; state: McpServerRuntimeState; toolCount: number; disabled: boolean }>;
  totalTools: number;
}

export interface McpServersResponse {
  scope: McpConfigScope;
  configPath: string;
  servers: McpServerSummary[];
  managedServers?: HazeManagedMcpSummary[];
  diagnostics: string[];
}

/** An HTTP MCP installed from Haze. It is runtime-managed and cannot be edited as a normal MCP server. */
export interface HazeManagedMcpSummary {
  capabilityId: string;
  name: string;
  version: string;
  scope: McpConfigScope;
  serverUrl: string;
  disabled: boolean;
}
