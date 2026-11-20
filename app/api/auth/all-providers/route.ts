import { getProviderModelRuntime } from "@/server/models/provider-model-runtime";
import { buildApiKeyProviderList } from "@/server/models/provider-listing";
import { collectProviderListingInputs } from "@/server/models/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see server/models/provider-listing.ts for why membership is capability-based (#309).
export async function GET() {
  const modelRuntime = await getProviderModelRuntime();
  const providers = buildApiKeyProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
