import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustStatus } from "./api-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function hasOrganizationPlugins(cwd: string): boolean {
  try {
    const registry = JSON.parse(readFileSync(join(cwd, ".pi", "eureka-haze-capabilities.json"), "utf8"));
    return Array.isArray(registry.installs) && registry.installs.some((item: { type?: string }) => item?.type === "Plugin");
  } catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
}

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && (hasTrustRequiringProjectResources(cwd) || hasOrganizationPlugins(cwd));
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  const trustStore = new ProjectTrustStore(agentDir);
  return {
    requiresTrust: true,
    trusted: trustStore.get(cwd) === true,
  };
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  new ProjectTrustStore(agentDir).set(cwd, true);
  return { requiresTrust: true, trusted: true };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Eureka *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Eureka runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Eureka and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}
