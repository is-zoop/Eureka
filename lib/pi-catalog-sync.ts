import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";

const CHECK_INTERVAL_MS = 15 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

interface PiCatalogState {
  enabled: boolean;
  lastSuccessAt?: number;
  error?: boolean;
}

declare global {
  var __eurekaPiCatalogTimer: ReturnType<typeof setInterval> | undefined;
  var __eurekaPiCatalogTask: Promise<void> | undefined;
}

function statePath(): string {
  return join(getAgentDir(), "eureka-pi-catalog.json");
}

function readState(): PiCatalogState {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const state = value as Record<string, unknown>;
      return {
        enabled: state.enabled === true,
        ...(typeof state.lastSuccessAt === "number" ? { lastSuccessAt: state.lastSuccessAt } : {}),
        ...(state.error === true ? { error: true } : {}),
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false };
  }
  return { enabled: false };
}

function writeState(state: PiCatalogState): void {
  const path = statePath();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify(state, null, 2));
}

export function piCatalogStatus(): PiCatalogState & { offline: boolean } {
  return { ...readState(), offline: process.env.PI_OFFLINE !== undefined };
}

export function setPiCatalogEnabled(enabled: boolean): PiCatalogState & { offline: boolean } {
  const current = readState();
  writeState({ ...current, enabled, ...(enabled ? {} : { error: undefined }) });
  return piCatalogStatus();
}

/** Refreshes Pi's persisted models-store; no provider /models endpoint is contacted. */
export async function refreshPiCatalog(force = false): Promise<void> {
  const state = readState();
  if (!state.enabled || process.env.PI_OFFLINE !== undefined) return;
  try {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: true,
      refreshOnCreate: false,
      modelRefreshTimeoutMs: REFRESH_TIMEOUT_MS,
    });
    const result = await runtime.refresh({ allowNetwork: true, force });
    if (result.errors.size > 0) throw new Error("Pi model catalog refresh failed");
    writeState({ ...readState(), enabled: true, lastSuccessAt: Date.now(), error: false });
    invalidateModelsCache();
  } catch {
    // Pi retains its last valid models-store snapshot. Do not expose provider details.
    writeState({ ...readState(), enabled: true, error: true });
  }
}

export function schedulePiCatalogSync(): void {
  const run = () => {
    if (globalThis.__eurekaPiCatalogTask || !readState().enabled) return;
    globalThis.__eurekaPiCatalogTask = refreshPiCatalog().finally(() => {
      globalThis.__eurekaPiCatalogTask = undefined;
    });
  };
  if (!globalThis.__eurekaPiCatalogTimer) {
    globalThis.__eurekaPiCatalogTimer = setInterval(run, CHECK_INTERVAL_MS);
    globalThis.__eurekaPiCatalogTimer.unref();
  }
  run();
}
