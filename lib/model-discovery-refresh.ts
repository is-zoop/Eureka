import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { discoverModelsFromProvider, hasCommandBackedCredentials } from "./model-discovery-client";
import { readModelsConfig, writeModelsConfig } from "./models-config-store";

export const AUTO_DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_MS = 60 * 60 * 1000;
const MAX_RETRY_MS = AUTO_DISCOVERY_INTERVAL_MS;

export interface ModelDiscoveryProviderState {
  enabled: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextAttemptAt?: number;
  failureCount?: number;
  /** Deliberately generic: upstream error bodies can contain credentials. */
  lastError?: "discovery_failed" | "unsafe_credentials" | "config_changed";
}

export interface ModelDiscoveryState {
  version: 1;
  providers: Record<string, ModelDiscoveryProviderState>;
}

type ConfigProvider = Record<string, unknown> & { models?: Array<Record<string, unknown>> };

declare global {
  var __piModelDiscoveryRefresh: Promise<void> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function statePath(): string {
  return join(getAgentDir(), "models-discovery-state.json");
}

function ensureFile(path: string, initial: string): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!existsSync(path)) writePrivateFileAtomicSync(path, initial);
}

export function readModelDiscoveryState(path = statePath()): ModelDiscoveryState {
  if (!existsSync(path)) return { version: 1, providers: {} };
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || !isRecord(value.providers)) return { version: 1, providers: {} };
    const providers = Object.fromEntries(Object.entries(value.providers).flatMap(([name, entry]) => {
      if (!isRecord(entry) || typeof entry.enabled !== "boolean") return [];
      const state: ModelDiscoveryProviderState = { enabled: entry.enabled };
      for (const key of ["lastAttemptAt", "lastSuccessAt", "nextAttemptAt", "failureCount"] as const) {
        if (typeof entry[key] === "number" && Number.isFinite(entry[key])) state[key] = entry[key];
      }
      if (entry.lastError === "discovery_failed" || entry.lastError === "unsafe_credentials" || entry.lastError === "config_changed") state.lastError = entry.lastError;
      return [[name, state]];
    }));
    return { version: 1, providers };
  } catch {
    return { version: 1, providers: {} };
  }
}

function writeModelDiscoveryState(state: ModelDiscoveryState, path = statePath()): void {
  ensureFile(path, JSON.stringify({ version: 1, providers: {} }, null, 2));
  writePrivateFileAtomicSync(path, JSON.stringify(state, null, 2));
}

export function setModelDiscoveryEnabled(providerName: string, enabled: boolean): ModelDiscoveryState {
  const config = readModelsConfig();
  if (!isRecord(config.providers) || !isRecord(config.providers[providerName])) {
    throw new Error(`Unknown configured provider: ${providerName}`);
  }
  const state = readModelDiscoveryState();
  state.providers[providerName] = { ...state.providers[providerName], enabled };
  writeModelDiscoveryState(state);
  return state;
}

function retryDelay(failureCount: number): number {
  return Math.min(MAX_RETRY_MS, MIN_RETRY_MS * (2 ** Math.max(0, failureCount - 1)));
}

function stableProviderFingerprint(provider: ConfigProvider): string {
  return JSON.stringify({ baseUrl: provider.baseUrl, api: provider.api, apiKey: provider.apiKey, headers: provider.headers });
}

async function addModelsWithoutOverwriting(
  providerName: string,
  expectedFingerprint: string,
  discovered: Array<{ id: string; name?: string }>,
): Promise<number | "config_changed"> {
  const path = modelsPath();
  ensureFile(path, JSON.stringify({ providers: {} }, null, 2));
  const release = await lockfile.lock(path, {
    retries: { retries: 6, factor: 2, minTimeout: 100, maxTimeout: 3_000, randomize: true },
    stale: 30_000,
  });
  try {
    const config = readModelsConfig(path);
    if (!isRecord(config.providers) || !isRecord(config.providers[providerName])) return "config_changed";
    const provider = config.providers[providerName] as ConfigProvider;
    if (stableProviderFingerprint(provider) !== expectedFingerprint) return "config_changed";
    const models = Array.isArray(provider.models) ? [...provider.models] : [];
    const known = new Set(models.flatMap((model) => typeof model.id === "string" ? [model.id] : []));
    const additions = discovered.filter((model) => !known.has(model.id));
    if (additions.length === 0) return 0;
    provider.models = [...models, ...additions.map((model) => model.name ? { id: model.id, name: model.name } : { id: model.id })];
    writeModelsConfig(config, path);
    return additions.length;
  } finally {
    await release();
  }
}

export async function refreshConfiguredProvider(providerName: string): Promise<{ added: number; status: "success" | "skipped" | "failed" }> {
  const config = readModelsConfig();
  const provider = isRecord(config.providers) && isRecord(config.providers[providerName])
    ? config.providers[providerName] as ConfigProvider
    : undefined;
  const state = readModelDiscoveryState();
  const previous = state.providers[providerName];
  if (!provider || !previous?.enabled) return { added: 0, status: "skipped" };

  const now = Date.now();
  const record = (next: ModelDiscoveryProviderState) => {
    state.providers[providerName] = next;
    writeModelDiscoveryState(state);
  };
  if (hasCommandBackedCredentials(provider)) {
    record({ ...previous, lastAttemptAt: now, nextAttemptAt: now + AUTO_DISCOVERY_INTERVAL_MS, lastError: "unsafe_credentials" });
    return { added: 0, status: "skipped" };
  }

  try {
    const fingerprint = stableProviderFingerprint(provider);
    const result = await discoverModelsFromProvider(providerName, provider);
    const added = await addModelsWithoutOverwriting(providerName, fingerprint, result.models);
    if (added === "config_changed") {
      record({ ...previous, lastAttemptAt: now, nextAttemptAt: now + MIN_RETRY_MS, lastError: "config_changed" });
      return { added: 0, status: "skipped" };
    }
    record({ enabled: true, lastAttemptAt: now, lastSuccessAt: now, nextAttemptAt: now + AUTO_DISCOVERY_INTERVAL_MS, failureCount: 0 });
    return { added, status: "success" };
  } catch {
    const failureCount = (previous.failureCount ?? 0) + 1;
    record({ ...previous, lastAttemptAt: now, nextAttemptAt: now + retryDelay(failureCount), failureCount, lastError: "discovery_failed" });
    return { added: 0, status: "failed" };
  }
}

export function refreshDueModelDiscoveries(): Promise<void> {
  if (globalThis.__piModelDiscoveryRefresh) return globalThis.__piModelDiscoveryRefresh;
  let task: Promise<void>;
  task = (async () => {
    const state = readModelDiscoveryState();
    const now = Date.now();
    for (const [providerName, providerState] of Object.entries(state.providers)) {
      if (providerState.enabled && (providerState.nextAttemptAt ?? 0) <= now) {
        await refreshConfiguredProvider(providerName);
      }
    }
  })().finally(() => {
    if (globalThis.__piModelDiscoveryRefresh === task) globalThis.__piModelDiscoveryRefresh = undefined;
  });
  globalThis.__piModelDiscoveryRefresh = task;
  return task;
}
