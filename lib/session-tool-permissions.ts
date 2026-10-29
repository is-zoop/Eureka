import { PRESET_DEFAULT, PRESET_FULL, type ToolEntry } from "./tool-presets";

const ENTRY_TYPE = "eureka_tool_permissions";
type Entry = { type: string; customType?: string; data?: unknown };
type Manager = { getEntries(): Entry[]; appendCustomEntry(type: string, data: unknown): unknown };

export function validateSessionToolNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !PRESET_FULL.includes(name))) {
    throw new Error("Invalid tool permissions");
  }
  return [...new Set(value as string[])];
}

/** Normal session permissions, separate from a plan's temporary tool restrictions. */
export function readSessionToolNames(entries: Entry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    try { return validateSessionToolNames((entry.data as { toolNames?: unknown })?.toolNames); }
    catch { /* Ignore malformed historical metadata. */ }
  }
  return undefined;
}

export function saveSessionToolNames(manager: Manager, value: unknown) {
  const toolNames = validateSessionToolNames(value);
  const previous = readSessionToolNames(manager.getEntries());
  if (previous && previous.length === toolNames.length && previous.every((name) => toolNames.includes(name))) return;
  manager.appendCustomEntry(ENTRY_TYPE, { toolNames });
}

/** An idle session needs no extensions or AgentSession just to show its preset. */
export function sessionToolEntries(entries: Entry[]): ToolEntry[] {
  const active = new Set(readSessionToolNames(entries) ?? PRESET_DEFAULT);
  return PRESET_FULL.map((name) => ({ name, active: active.has(name), description: "" }));
}
