import { getAuthConfig } from "@/lib/auth/config";
import { readAuthSession } from "@/lib/auth/session";
import { readRuntimeHazeSession } from "@/lib/auth/runtime-session";
import { automationOwnerKey } from "./automation-owner";

export class DraftIdentityError extends Error {}
export async function automationAccess() {
  const config = getAuthConfig();
  const session = await readAuthSession();
  if (!config || !session?.runtimeId) throw new DraftIdentityError();
  const assertIdentity = () => {
    const current = readRuntimeHazeSession();
    if (!current || current.runtimeId !== session.runtimeId || current.principal.subject !== session.principal.subject
      || current.providerId !== session.providerId) throw new DraftIdentityError();
  };
  assertIdentity();
  return { issuer: config.issuer, subject: session.principal.subject, ownerKey: automationOwnerKey(config.issuer, session.principal.subject), assertIdentity };
}
