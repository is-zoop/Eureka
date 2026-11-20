import "server-only";

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createJiti } from "jiti";
import { getAgentDir, ModelRegistry, readStoredCredential, type ExtensionContext, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getProviderModelRuntime } from "./provider-model-runtime";
import type { SubscriptionAccount, SubscriptionQuotas, SubscriptionResetCredit, SubscriptionResetResult } from "../../features/settings/shared/subscription-quotas";

const QUERY_TIMEOUT_MS = 8_000;
const QUOTE_LIFETIME_MS = 5 * 60_000;
const quoteKey = randomBytes(32);
// Usage and reset auth must share a salt across the package's separate entry points.
const authFingerprintSalt = randomBytes(32);

type UsageContext = Pick<ExtensionContext, "model" | "modelRegistry">;
type Adapter = { id: string; displayName: string; providerIds: readonly string[]; officialOrigins: readonly string[]; requiresOAuth?: boolean };
type UsageAuth = { headers: Record<string, string>; fingerprint: string; usageFingerprint?: string };
type UsageReport = {
  buckets: { id: string; label: string; groupId?: string; groupLabel?: string; unit: string; windowMinutes?: number; resetsAt?: number; used?: number; remaining?: number; limit?: number; modelKeys?: string[] }[];
  metrics: { id: string; value: unknown }[];
};
type ResetOption = { creditId?: string; title: string; expiresAt?: number };
type RedeemOutcome = Exclude<SubscriptionResetResult, "stale" | "unknown">;
type UsageModule = {
  adapterForProvider(id: string): Adapter | undefined;
  resolveUsageAuth(ctx: UsageContext, adapter: Adapter, salt: Uint8Array): Promise<UsageAuth | undefined>;
  queryProviderUsage(adapter: Adapter, auth: UsageAuth, signal: AbortSignal, timeout: number): Promise<UsageReport>;
};
type ResetModule = {
  resolveCodexResetAuth(ctx: UsageContext, salt?: Uint8Array, reader?: (id: string) => unknown): Promise<UsageAuth>;
  listCodexResetCredits(auth: UsageAuth, signal: AbortSignal, timeout: number): Promise<{ options: ResetOption[] }>;
  consumeCodexResetCredit(auth: UsageAuth, option: ResetOption, key: string, signal: AbortSignal, timeout: number): Promise<{ code: RedeemOutcome }>;
};
type CodexAccountModule = { codexAccountIdFromAccessToken(access: string): string | undefined };
type Extension = { usage: UsageModule; resets: ResetModule; codexAccount: CodexAccountModule };

let loaded: Promise<Extension> | undefined;

function loadExtension(): Promise<Extension> {
  if (loaded) return loaded;
  // The pinned dependency ships TypeScript source. Load its provider logic without registering its TUI commands.
  const loader = createJiti(join(process.cwd(), "package.json"), { interopDefault: true });
  loaded = Promise.all([
    loader.import<UsageModule>("@specode/pi-subscription-usage/src/query.ts"),
    loader.import<ResetModule>("@specode/pi-subscription-usage/src/codex-resets.ts"),
    loader.import<CodexAccountModule>("@specode/pi-subscription-usage/src/codex-reset-core.ts"),
  ]).then(([usage, resets, codexAccount]) => ({ usage, resets, codexAccount }), (error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

function contextFor(runtime: ModelRuntime, adapter: Adapter, id: string): UsageContext | undefined {
  const model = runtime.getModels(id).find((candidate) => {
    try { return adapter.officialOrigins.includes(new URL(candidate.baseUrl).origin); }
    catch { return false; }
  });
  if (!model) return undefined;
  return { model, modelRegistry: new ModelRegistry(runtime) };
}

function canReset(id: string): boolean {
  return id === "openai-codex" || id === "openai";
}

function scopeCodexUsageAuth(auth: UsageAuth, codexAccount: CodexAccountModule): UsageAuth {
  // Both OpenAI usage adapters use the Codex backend credential. Scope the read to its account.
  const token = /^Bearer\s+(\S+)$/i.exec(auth.headers.Authorization ?? "")?.[1];
  const accountId = token && codexAccount.codexAccountIdFromAccessToken(token);
  return accountId ? { ...auth, headers: { ...auth.headers, "chatgpt-account-id": accountId } } : auth;
}

function resolveResetAuth(extension: Extension, ctx: UsageContext, agentDir: string) {
  return extension.resets.resolveCodexResetAuth(ctx, authFingerprintSalt, (id) => readStoredCredential(id, join(agentDir, "auth.json")));
}

function quoteSignature(provider: string, credit: string, fingerprint: string, message: string) {
  return createHmac("sha256", quoteKey).update(JSON.stringify([provider, credit, fingerprint, message])).digest();
}

function issueQuote(provider: string, credit: string, auth: UsageAuth): string {
  const message = `${Date.now() + QUOTE_LIFETIME_MS}.${randomUUID()}`;
  return `${message}.${quoteSignature(provider, credit, auth.fingerprint, message).toString("hex")}`;
}

function verifyQuote(provider: string, credit: string, auth: UsageAuth, quote: string): string | undefined {
  const match = /^(\d{13})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(quote);
  if (!match || Number(match[1]) <= Date.now()) return undefined;
  const expected = quoteSignature(provider, credit, auth.fingerprint, `${match[1]}.${match[2]}`);
  return timingSafeEqual(expected, Buffer.from(match[3], "hex")) ? match[2] : undefined;
}

function displayText(value: unknown, length: number): string | undefined {
  return typeof value === "string" ? value.replace(/\p{Cc}/gu, " ").trim().slice(0, length) || undefined : undefined;
}

function metric(report: UsageReport, id: string) {
  return displayText(report.metrics.find((item) => item.id === id)?.value, 120);
}

function remainingPercent(bucket: UsageReport["buckets"][number]): number | undefined {
  const limit = bucket.limit ?? (bucket.unit === "percent" ? 100 : undefined);
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
  const remaining = bucket.remaining ?? (bucket.used === undefined ? undefined : limit - bucket.used);
  return remaining !== undefined && Number.isFinite(remaining) ? Math.min(100, Math.max(0, remaining / limit * 100)) : undefined;
}

function toAccount(id: string, name: string, report: UsageReport): SubscriptionAccount {
  const windows = report.buckets.flatMap((bucket) => {
    const remaining = remainingPercent(bucket);
    const label = displayText(bucket.label, 100);
    if (remaining === undefined || !label) return [];
    return [{ id: bucket.id, label, group: displayText(bucket.groupLabel, 100), remainingPercent: remaining, windowMinutes: bucket.windowMinutes, resetsAt: bucket.resetsAt }];
  }).slice(0, 24);
  return { id, name, plan: metric(report, "plan"), email: metric(report, "email"), status: windows.length ? "ready" : "unavailable", windows };
}

async function readAccount(extension: Extension, runtime: ModelRuntime, agentDir: string, id: string, signal: AbortSignal, preview: boolean): Promise<SubscriptionAccount> {
  const adapter = extension.usage.adapterForProvider(id);
  const name = adapter?.displayName ?? runtime.getProvider(id)?.name ?? id;
  const unavailable: SubscriptionAccount = { id, name, status: "unavailable", windows: [] };
  const ctx = adapter && contextFor(runtime, adapter, id);
  if (!adapter || !ctx) return unavailable;
  try {
    const auth = await extension.usage.resolveUsageAuth(ctx, adapter, authFingerprintSalt);
    if (!auth || signal.aborted) return unavailable;
    const usageAuth = canReset(id) ? scopeCodexUsageAuth(auth, extension.codexAccount) : auth;
    const report = await extension.usage.queryProviderUsage(adapter, usageAuth, signal, QUERY_TIMEOUT_MS);
    const account = toAccount(id, name, report);
    if (!canReset(id) || account.status !== "ready" || signal.aborted) return account;
    try {
      const resetAuth = await resolveResetAuth(extension, ctx, agentDir);
      if (resetAuth.usageFingerprint !== auth.fingerprint) return unavailable;
      const { options } = await extension.resets.listCodexResetCredits(resetAuth, signal, QUERY_TIMEOUT_MS);
      const credits = options.flatMap((option): SubscriptionResetCredit[] => option.creditId ? [{
        id: option.creditId, title: displayText(option.title, 140) ?? "",
        expiresAt: option.expiresAt,
        ...(preview ? {} : { quote: issueQuote(id, option.creditId, resetAuth) }),
      }] : []);
      account.resets = { available: credits.length, nextExpiry: credits[0]?.expiresAt, ...(preview ? {} : { credits }) };
    } catch { /* The available quota can still be displayed. */ }
    return account;
  } catch {
    return unavailable;
  }
}

export async function readSubscriptionQuotas(signal: AbortSignal, preview: boolean): Promise<SubscriptionQuotas> {
  const agentDir = getAgentDir();
  const extension = await loadExtension();
  const runtime = await getProviderModelRuntime(agentDir);
  const ids = (await runtime.listCredentials()).filter(({ providerId, type }) =>
    (type === "oauth" && (Boolean(extension.usage.adapterForProvider(providerId)) || runtime.isUsingSubscription(providerId)))
    || (type === "api_key" && providerId === "opencode-go"),
  ).map(({ providerId }) => providerId);
  const accounts = await Promise.all(ids.map((id) => readAccount(extension, runtime, agentDir, id, signal, preview)));
  return { accounts };
}

export async function redeemSubscriptionReset(provider: string, credit: string, quote: string, signal: AbortSignal): Promise<SubscriptionResetResult> {
  if (!canReset(provider)) return "stale";
  const agentDir = getAgentDir();
  let submitted = false;
  try {
    const extension = await loadExtension();
    const runtime = await getProviderModelRuntime(agentDir);
    const adapter = extension.usage.adapterForProvider(provider);
    const ctx = adapter && contextFor(runtime, adapter, provider);
    if (!adapter || !ctx) return "stale";
    const auth = await resolveResetAuth(extension, ctx, agentDir);
    const requestId = verifyQuote(provider, credit, auth, quote);
    if (!requestId) return "stale";
    const { options } = await extension.resets.listCodexResetCredits(auth, signal, QUERY_TIMEOUT_MS);
    const option = options.find((item) => item.creditId === credit);
    if (!option) return "stale";
    if (provider === "openai") await extension.usage.queryProviderUsage(adapter, auth, signal, QUERY_TIMEOUT_MS);
    const checked = await resolveResetAuth(extension, ctx, agentDir);
    if (checked.fingerprint !== auth.fingerprint || signal.aborted) return "stale";
    submitted = true;
    return (await extension.resets.consumeCodexResetCredit(checked, option, requestId, signal, QUERY_TIMEOUT_MS)).code;
  } catch {
    return submitted ? "unknown" : "stale";
  }
}
