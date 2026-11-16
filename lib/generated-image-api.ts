import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { localAutomationContext } from "./automation-local-context";
import { isApiRequestAllowed } from "./request-security";
import { GeneratedImageStore, ImageGenerationError } from "./generated-images";
export function generatedImageAccess(request: Request) {
  if (!isApiRequestAllowed(request)) throw new ImageGenerationError("forbidden", 403);
  const base = getAgentDir(), identity = localAutomationContext(base);
  return new GeneratedImageStore(base, identity.ownerKey, identity.assertIdentity);
}
export function generatedImageFailure(error: unknown) {
  const safe = error instanceof ImageGenerationError ? error : new ImageGenerationError("storage", 500);
  return NextResponse.json({ error: safe.code }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
}

export { ImageGenerationError };
