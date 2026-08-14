import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface EventShape {
  count: number;
  keys: string[];
  nestedKeys: Record<string, string[]>;
}

export interface EventJournalReport {
  generatedAt: string;
  eventTypes: Record<string, EventShape>;
  assertions: Record<string, boolean>;
}

function objectKeys(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value).sort() : [];
}

/** Captures only structural metadata, never prompts, credentials, or tool output. */
export class EventJournal {
  private readonly shapes = new Map<string, EventShape>();

  record(event: AgentSessionEvent): void {
    const type = event.type;
    const current = this.shapes.get(type) ?? { count: 0, keys: [], nestedKeys: {} };
    current.count += 1;
    current.keys = [...new Set([...current.keys, ...objectKeys(event)])].sort();

    for (const [key, value] of Object.entries(event)) {
      const keys = objectKeys(value);
      if (keys.length > 0) {
        current.nestedKeys[key] = [...new Set([...(current.nestedKeys[key] ?? []), ...keys])].sort();
      }
    }

    this.shapes.set(type, current);
  }

  has(type: string): boolean {
    return this.shapes.has(type);
  }

  toReport(assertions: Record<string, boolean>): EventJournalReport {
    return {
      generatedAt: new Date().toISOString(),
      eventTypes: Object.fromEntries([...this.shapes.entries()].sort(([a], [b]) => a.localeCompare(b))),
      assertions,
    };
  }
}
