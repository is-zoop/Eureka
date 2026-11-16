import type { AutomationAppDetail } from "./automation-app";
import { isDesktopBrowserHost } from "./native-browser";

export interface AppCredentialSpec { credentialId: string; kind: "bearer" | "api-key"; header?: string; scopes: { url: string; method: string }[] }
export function appCredentialSpecs(detail: AutomationAppDetail): AppCredentialSpec[] {
  const specs = new Map<string, AppCredentialSpec>();
  for (const site of detail.manifest.automation.browser?.sites ?? []) for (const operation of site.operations) {
    const request = operation.request, auth = request?.auth; if (!request || !auth) continue;
    const url = new URL(request.url), scope = { url: url.origin + url.pathname, method: request.method };
    let spec = specs.get(auth.credentialId);
    if (spec && (spec.kind !== auth.kind || (spec.header ?? "X-API-Key").toLowerCase() !== (auth.header ?? "X-API-Key").toLowerCase())) throw new Error("credentialDeclarationConflict");
    if (!spec) { spec = { ...auth, scopes: [] }; specs.set(auth.credentialId, spec); }
    if (!spec.scopes.some(item => item.url === scope.url && item.method === scope.method)) spec.scopes.push(scope);
  }
  return [...specs.values()];
}
export async function appCredentialCommand(owner: string, appId: string, action: "status" | "set" | "delete" | "clear", spec?: AppCredentialSpec, value?: string) {
  if (!isDesktopBrowserHost()) { if (action === "clear") return { configured: false }; throw new Error("credentialDesktopRequired"); }
  const response = await fetch("/api/automation/identity", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const identity = await response.json();
  if (!response.ok || identity.ownerKey !== owner && !identity.ownerKeys?.includes(owner)) throw new Error("identityUnavailable");
  const { invoke } = await import("@tauri-apps/api/core");
  // Neither the server nor application code receives credential values.
  try { return await invoke<{ configured: boolean }>("desktop_automation_credentials", { owner, appId, action, spec: spec ?? null, value: value ?? null }); }
  catch (error) { if (action === "clear" && typeof error === "string" && /desktop_automation_credentials.*not found|unknown command/i.test(error)) return { configured: false }; throw new Error("credentialOperationFailed"); }
}
