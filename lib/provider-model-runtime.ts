import { createAgentSessionServices, getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createCompatibleModelRuntime, restoreKimiCodingCompatibility, restoreLegacyAzureProvider } from "./model-runtime-compat";
import { modelsCacheGeneration } from "./models-cache";
import { samePath } from "./paths";

/** Auth routes need the same installed provider extensions as chat sessions. No AgentSession is created. */
export async function createProviderModelRuntime(
  agentDir = getAgentDir(),
  options: Parameters<typeof createCompatibleModelRuntime>[0] = {},
): Promise<ModelRuntime> {
  const runtime = await createCompatibleModelRuntime({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    modelsStorePath: join(agentDir, "models-store.json"),
    ...options,
  });
  const services = await createAgentSessionServices({
    cwd: agentDir,
    agentDir,
    modelRuntime: runtime,
    resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
    // Global packages are installation-owned. Never authorize a project's extension from an auth read.
    resourceLoaderReloadOptions: { resolveProjectTrust: async () => false },
  });
  restoreKimiCodingCompatibility(runtime);
  await restoreLegacyAzureProvider(runtime, services.settingsManager);
  return runtime;
}

interface ProviderRuntimeEntry {
  agentDir: string;
  generation: number;
  expiresAt: number;
  runtime: Promise<ModelRuntime>;
  queue: Promise<void>;
}
declare global { var __eurekaProviderModelRuntime: ProviderRuntimeEntry | undefined; }
const TTL_MS = 60 * 60_000;

/** Reuse extension registration, but reread credentials/models offline before every status read. */
export async function getProviderModelRuntime(agentDir = getAgentDir()): Promise<ModelRuntime> {
  const generation = modelsCacheGeneration();
  let entry = globalThis.__eurekaProviderModelRuntime;
  if (!entry || !samePath(entry.agentDir, agentDir) || entry.generation !== generation || entry.expiresAt <= Date.now()) {
    entry = { agentDir, generation, expiresAt: Infinity, runtime: createProviderModelRuntime(agentDir), queue: Promise.resolve() };
    const created = entry;
    globalThis.__eurekaProviderModelRuntime = created;
    created.runtime.then(() => { created.expiresAt = Date.now() + TTL_MS; }, () => {
      if (globalThis.__eurekaProviderModelRuntime === created) globalThis.__eurekaProviderModelRuntime = undefined;
    });
  }
  const runtime = await entry.runtime;
  const refresh = entry.queue.then(async () => { await runtime.refresh({ allowNetwork: false }); return runtime; });
  entry.queue = refresh.then(() => {}, () => {});
  return refresh;
}
