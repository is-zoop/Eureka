import { stat } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readAutomationMode, type AutomationModeRecord } from "../shared/automation-mode";
import { resolveSessionPath } from "../../sessions/server/session-reader";
import { peekRpcSession } from "../../../server/agent/rpc-session-registry";
import { AutomationAppError } from "./automation-app-package";

/** Retains only small mode records, never SessionManager/transcript objects. */
export class AutomationModeFileCache {
  private entries = new Map<string, { signature: string; value: Promise<AutomationModeRecord | null> }>();
  async read(file: string, load: () => AutomationModeRecord | null) {
    const info = await stat(file, { bigint: true });
    const signature = `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
    const previous = this.entries.get(file);
    if (previous?.signature === signature) return structuredClone(await previous.value);
    const entry = { signature, value: Promise.resolve().then(load) };
    while (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(file, entry);
    try { return structuredClone(await entry.value); }
    catch (error) { if (this.entries.get(file) === entry) this.entries.delete(file); throw error; }
  }
}
declare global { var __eurekaAutomationModeFiles: AutomationModeFileCache | undefined; }
const cache = globalThis.__eurekaAutomationModeFiles ??= new AutomationModeFileCache();

export async function automationModeFromSession(sessionId: string) {
  const live = peekRpcSession(sessionId);
  if (live) return readAutomationMode(live.inner.sessionManager.getBranch());
  const file = await resolveSessionPath(sessionId);
  if (!file) throw new AutomationAppError("会话不存在。", 404);
  return cache.read(file, () => readAutomationMode(SessionManager.open(file).getBranch()));
}
