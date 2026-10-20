/** Validate the host-owned credential request; never accept instructions from the package. */
export function validatePluginCredentialRequest(guard, envelope, issuer, session) {
  if (!guard || typeof guard.url !== "string" || typeof guard.subject !== "string" || typeof guard.source !== "string") throw new Error("Invalid plugin credential binding");
  if (envelope.url !== guard.url) throw new Error("Plugin MCP request address was not approved");
  if (issuer !== guard.source || session?.principal?.subject !== guard.subject) throw new Error("Haze account changed; confirm this plugin's service addresses again");
}
