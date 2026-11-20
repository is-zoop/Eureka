import { getProviderModelRuntime } from "@/server/models/provider-model-runtime";
import { buildOAuthProviderList } from "@/server/models/provider-listing";
import { collectProviderListingInputs } from "@/server/models/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max). See server/models/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await getProviderModelRuntime();
  const providers = buildOAuthProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
