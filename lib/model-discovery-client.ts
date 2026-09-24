import { resolveModelDiscoveryAuth } from "./model-discovery-auth";
import { buildModelsListUrl, parseDiscoveredModels, type DiscoveredModel } from "./model-discovery";

const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024;

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function hasCommandBackedCredentials(provider: Record<string, unknown>): boolean {
  const apiKey = provider.apiKey;
  if (typeof apiKey === "string" && apiKey.trimStart().startsWith("!")) return true;
  return Object.values(stringRecord(provider.headers)).some((value) => value.trimStart().startsWith("!"));
}

function buildHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

export async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DISCOVERY_RESPONSE_BYTES) {
    throw new Error("Upstream model list was too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DISCOVERY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Upstream model list was too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function discoverModelsFromProvider(
  providerName: string,
  provider: Record<string, unknown>,
): Promise<{ models: DiscoveredModel[]; endpoint: string }> {
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
  if (!baseUrl) throw new Error("Base URL is required");
  const api = typeof provider.api === "string" && provider.api ? provider.api : "openai-completions";
  let endpoint: URL;
  try {
    endpoint = buildModelsListUrl(baseUrl, api);
  } catch {
    throw new Error("Base URL is invalid");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("Base URL must use HTTP or HTTPS");
  }

  const auth = await resolveModelDiscoveryAuth(providerName, provider);
  if (typeof provider.apiKey === "string" && provider.apiKey.trim() && !auth.apiKey) {
    throw new Error(`No API key found for "${providerName}"`);
  }
  const response = await fetch(endpoint, {
    cache: "no-store",
    redirect: "error",
    headers: buildHeaders(api, auth.apiKey, auth.headers),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  const responseText = await readBoundedText(response);
  if (!response.ok) throw new Error(responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("Upstream model list was not valid JSON");
  }
  const models = parseDiscoveredModels(payload);
  if (models.length === 0) throw new Error("No models found in the upstream response");
  return { models, endpoint: endpoint.toString() };
}
