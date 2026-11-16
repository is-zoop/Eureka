import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Match Pi's login options so ChatGPT uses the same persistent device identity. */
export function createProviderLoginOptions(agentDir = getAgentDir()) {
  const settings = SettingsManager.create(agentDir, agentDir);
  return {
    options: { getDeviceId: () => settings.getOrCreateDeviceId() },
    flush: () => settings.flush(),
  };
}
