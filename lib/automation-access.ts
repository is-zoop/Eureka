import { getAuthConfig } from "@/lib/auth/config";
import { readAuthSession } from "@/lib/auth/session";
import { readRuntimeHazeSession } from "@/lib/auth/runtime-session";
import { automationOwnerKey } from "./automation-owner";
import { localAutomationContext } from "./automation-local-context";

export class DraftIdentityError extends Error {}
/** Cloud publishing/sync only. Local editing and execution never use this. */
export async function hazeAutomationAccess() {
  const config = getAuthConfig();
  if (!config) throw new DraftIdentityError();
  const session = await readAuthSession();
  if (!config || !session?.runtimeId) throw new DraftIdentityError();
  const assertIdentity = () => {
    const current = readRuntimeHazeSession();
    if (!current || current.runtimeId !== session.runtimeId || current.principal.subject !== session.principal.subject
      || current.providerId !== session.providerId) throw new DraftIdentityError();
  };
  assertIdentity();
  return { issuer: config.issuer, subject: session.principal.subject, runtimeId: session.runtimeId, ownerKey: automationOwnerKey(config.issuer, session.principal.subject), assertIdentity };
}

export async function automationAccess() { return localAutomationContext(); }
