interface TimingEntry {
  type: string;
  timestamp: string;
  message?: { role?: string };
  customType?: string;
  data?: unknown;
}

/**
 * Estimate active wall-clock time from the append-only session log.
 *
 * Raw entries preserve compacted history and every executed branch exactly
 * once. Gaps ending at user messages are treated as human idle. User-initiated
 * bash entries are also boundaries because the log records only their finish
 * time, so counting the incoming gap could include arbitrary human idle.
 */
export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;
  let waiting = false;

  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "eureka_ui_wait") {
      const timestamp = Date.parse(entry.timestamp), active = (entry.data as { waiting?: unknown } | undefined)?.waiting;
      if (!Number.isFinite(timestamp) || typeof active !== "boolean") continue;
      if (!waiting && (entry.data as { active?: boolean } | undefined)?.active !== false && previousTimestamp !== undefined && timestamp > previousTimestamp) totalActiveMs += timestamp - previousTimestamp;
      previousTimestamp = timestamp; waiting = active;
      continue;
    }
    if (!isTimingEntry(entry.type)) continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }

    if (!waiting && previousTimestamp !== undefined && timestamp > previousTimestamp) {
      totalActiveMs += timestamp - previousTimestamp;
    }
    previousTimestamp = timestamp;
  }

  return totalActiveMs;
}

function isTimingEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}
