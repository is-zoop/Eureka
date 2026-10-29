import type { AgentMessage, SessionHistoryPage } from "./types";

/** Keep loaded pages, but trust the newest snapshot's ancestry and read-only boundary. */
export function mergeSessionHistory(previous: SessionHistoryPage | null, next: SessionHistoryPage): SessionHistoryPage {
  const positions = new Map(next.pathIds.map((id, index) => [id, index]));
  const boundary = next.latestCompactionId ? positions.get(next.latestCompactionId) ?? -1 : -1;
  const byId = new Map([...(previous?.items ?? []), ...next.items].map(item => [item.entryId, item]));
  const items = [...byId.values()].filter(item => positions.has(item.entryId))
    .sort((a, b) => positions.get(a.entryId)! - positions.get(b.entryId)!)
    .map(item => ({ ...item, readOnly: positions.get(item.entryId)! < boundary }));
  const intervals = [...(previous?.ranges ?? []), ...next.ranges]
    .filter(([start, end]) => positions.has(start) && positions.has(end))
    .map(([start, end]) => [positions.get(start)!, positions.get(end)!] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const interval of intervals) {
    const last = joined.at(-1);
    if (last && interval[0] <= last[1] + 1) last[1] = Math.max(last[1], interval[1]);
    else joined.push([...interval]);
  }
  const suffix = joined.at(-1);
  const start = suffix?.[1] === next.pathIds.length - 1 ? suffix[0] : next.pathIds.length;
  const hasMore = start > 0;
  return { ...next, items, hasMore, before: hasMore ? next.pathIds[start] ?? next.before : null,
    ranges: joined.map(([a, b]) => [next.pathIds[a], next.pathIds[b]]),
  };
}

export class SessionHistoryRequests {
  epoch = 0;
  sequence = 0;
  invalidate() { this.epoch++; this.sequence++; }
  begin() { return { epoch: this.epoch, sequence: ++this.sequence }; }
  current(request: { epoch: number; sequence: number }) { return request.epoch === this.epoch && request.sequence === this.sequence; }
}

export function projectSessionHistory(
  history: SessionHistoryPage | null,
  baselineCount: number,
  messages: AgentMessage[],
  entryIds: string[],
  temporaryKey: (message: AgentMessage) => string,
) {
  const persisted = history?.items ?? [];
  const tail = history ? messages.slice(baselineCount) : messages;
  return {
    messages: [...persisted.map(item => item.message), ...tail],
    entryIds: [...persisted.map(item => item.entryId), ...tail.map((_, index) => history ? "" : entryIds[index] ?? "")],
    keys: [...persisted.map(item => item.entryId), ...tail.map((message, index) => !history && entryIds[index] ? entryIds[index] : temporaryKey(message))],
    readOnly: [...persisted.map(item => item.readOnly), ...tail.map(() => false)],
    editAnchorEntryIds: [...persisted.map(item => item.editAnchorEntryId ?? ""), ...tail.map(() => "")],
  };
}
