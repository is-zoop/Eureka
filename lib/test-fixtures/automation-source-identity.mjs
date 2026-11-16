// Used only by the isolated source-authoring test; never reads a real Haze login.
export function assertCreationIdentity(binding) {
  if (binding.ownerKey !== "a".repeat(64)) throw new Error("fixture namespace changed");
}
