import type { HazeMcpIdentity } from "./haze-native-mcp-auth";

export interface HazeNativeMcpBinding {
  name: string;
  url: string;
  authenticated: boolean;
  identity: HazeMcpIdentity | null;
  /** Revalidate current install, approval, account and project trust. */
  validate(): void | Promise<void>;
}

declare global { var __eurekaHazeNativeMcpBindings: Map<string, Map<string, HazeNativeMcpBinding>> | undefined; }
const sessions = globalThis.__eurekaHazeNativeMcpBindings ??= new Map<string, Map<string, HazeNativeMcpBinding>>();

export function setHazeNativeMcpBindings(sessionId: string, bindings: HazeNativeMcpBinding[]): void {
  sessions.set(sessionId, new Map(bindings.map((binding) => [binding.name, binding])));
}
export function getHazeNativeMcpBinding(sessionId: string, name: string): HazeNativeMcpBinding | undefined {
  return sessions.get(sessionId)?.get(name);
}
export function clearHazeNativeMcpBindings(sessionId: string): void { sessions.delete(sessionId); }
