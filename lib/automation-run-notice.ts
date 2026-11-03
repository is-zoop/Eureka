import { appRunActive, type AppRunRecord } from "./automation-app-run";
import type { NotificationInput } from "./notification-store";

type RunState = Pick<AppRunRecord, "id" | "status" | "error">;

/** Loading a terminal record is history, not a new failure event. */
export function automationRunFailureNotice(scope: string, previous: RunState | null, current: RunState): NotificationInput | null {
  if (!previous || previous.id !== current.id || !appRunActive(previous.status)
    || !["failed", "interrupted"].includes(current.status) || !current.error?.trim()) return null;
  return { id: `automation-run:${scope}:${current.id}:${current.status}`, type: "error", message: current.error };
}
