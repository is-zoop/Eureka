import { ModelRuntime, type SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const LEGACY_AZURE = "azure-openai-responses";
const kimiCompatibleRuntimes = new WeakSet<ModelRuntime>();

/** Only the official legacy OpenAI endpoint needs /v1; explicit Anthropic and gateways keep their protocol. */
export function normalizeKimiCodingRequestModel<T extends Model<Api>>(model: T): T {
  if (model.provider !== "kimi-coding" || model.api !== "openai-completions") return model;
  try {
    const url = new URL(model.baseUrl);
    if (url.origin !== "https://api.kimi.com" || !/^\/coding\/*$/.test(url.pathname)) return model;
    url.pathname = "/coding/v1";
    return { ...model, baseUrl: url.toString() };
  } catch {
    return model;
  }
}

export function restoreKimiCodingCompatibility(runtime: ModelRuntime): void {
  if (kimiCompatibleRuntimes.has(runtime)) return;
  kimiCompatibleRuntimes.add(runtime);
  // Decorate the public dispatch boundary. Registering a provider here would
  // discard extension overrides and start an unrelated availability refresh.
  // This keeps the SDK's auth, extension dispatch and reload behavior intact.
  const stream = runtime.stream.bind(runtime);
  const streamSimple = runtime.streamSimple.bind(runtime);
  runtime.stream = (model, context, options) => stream(normalizeKimiCodingRequestModel(model), context, options);
  runtime.streamSimple = (model, context, options) => streamSimple(normalizeKimiCodingRequestModel(model), context, options);
}

/** Keep existing Azure credentials/configuration usable without rewriting user files. */
export async function restoreLegacyAzureProvider(
  runtime: ModelRuntime,
  settings?: SettingsManager,
  sessionUsesLegacyAzure = false,
): Promise<void> {
  const azure = runtime.getProvider("azure");
  if (!azure) return;
  const credentials = await runtime.listCredentials();
  const needed = sessionUsesLegacyAzure
    || runtime.getProvider(LEGACY_AZURE)
    || credentials.some((credential) => credential.providerId === LEGACY_AZURE)
    || settings?.getDefaultProvider() === LEGACY_AZURE
    || settings?.getEnabledModels()?.some((pattern) => pattern.includes(LEGACY_AZURE));
  if (!needed) return;

  runtime.registerNativeProvider({
    ...azure,
    id: LEGACY_AZURE,
    name: "Azure OpenAI (legacy)",
    getModels: () => azure.getModels().map((model) => ({ ...model, provider: LEGACY_AZURE })),
    getAllModels: () => (azure.getAllModels?.() ?? azure.getModels())
      .map((model) => ({ ...model, provider: LEGACY_AZURE })),
  });
  await runtime.refresh({ allowNetwork: false });
}

export async function createCompatibleModelRuntime(
  options?: Parameters<typeof ModelRuntime.create>[0],
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create(options);
  restoreKimiCodingCompatibility(runtime);
  await restoreLegacyAzureProvider(runtime);
  return runtime;
}
