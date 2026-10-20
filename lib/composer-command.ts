export interface ComposerCommand {
  name: string;
  label: string;
  prefix: string;
  arguments: string;
}

/** Display names omit invocation syntax; command identities remain unchanged. */
export function composerCommandLabel(name: string): string {
  return name.replace(/^\//, "").replace(/^skill:/, "");
}

/** A completed command prefix is presented as a chip; the draft stays canonical. */
export function parseComposerCommand(value: string, knownCommands: readonly string[] = []): ComposerCommand | null {
  const match = /^\/([^\s]+)([ \t]|\r?\n)([\s\S]*)$/.exec(value);
  if (!match) return null;
  const [, name, separator, args] = match;
  if (!/^skill:[^\s:]+$/.test(name) && !knownCommands.includes(name)) return null;
  return { name, label: composerCommandLabel(name), prefix: `/${name}${separator}`, arguments: args };
}

/** Restored, already-submitted skill invocations can omit their trailing space. */
export function restoreComposerCommand(value: string, knownCommands: readonly string[] = []): string {
  const match = /^\/([^\s]+)$/.exec(value);
  return match && (/^skill:[^\s:]+$/.test(match[1]) || knownCommands.includes(match[1])) ? `${value} ` : value;
}
