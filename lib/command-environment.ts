export type CommandEnvironment = "bash" | "powershell";
export const COMMAND_ENVIRONMENT_ENTRY = "eureka_command_environment";

export function saveSessionCommandEnvironment(manager: { getEntries(): { type: string; customType?: string; data?: unknown }[]; appendCustomEntry(type: string, data: unknown): unknown }, environment: CommandEnvironment) {
  const previous = [...manager.getEntries()].reverse().find(entry => entry.type === "custom" && entry.customType === COMMAND_ENVIRONMENT_ENTRY);
  if ((previous?.data as { environment?: unknown } | undefined)?.environment === environment) return;
  manager.appendCustomEntry(COMMAND_ENVIRONMENT_ENTRY, { environment });
}

export function commandTools(names: string[], environment: CommandEnvironment): string[] {
  return [...new Set(names.map(name => name === "bash" || name === "powershell" ? environment : name))];
}

export function sessionCommandEnvironment(entries: readonly { type: string; customType?: string; data?: unknown }[], active: readonly string[] = []): CommandEnvironment {
  for (const entry of [...entries].reverse()) {
    if (entry.type === "custom" && entry.customType === COMMAND_ENVIRONMENT_ENTRY) {
      const value = (entry.data as { environment?: unknown } | undefined)?.environment;
      if (value === "bash" || value === "powershell") return value;
    }
  }
  return active.includes("powershell") ? "powershell" : "bash";
}
