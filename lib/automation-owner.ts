import { createHash } from "node:crypto";

/** Shared owner key for applications, accounts and archived-session access. */
export function automationOwnerKey(issuer: string, subject: string): string {
  return createHash("sha256").update(JSON.stringify([issuer.replace(/\/$/, ""), subject])).digest("hex");
}
