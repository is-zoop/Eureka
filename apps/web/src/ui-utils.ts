import type { ClientCommand, WebFileEntry, WebMessage } from "@pi-web/protocol";

export const IMAGE_LIMIT = 20 * 1024 * 1024;
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export function fileSuggestions(draft: string, entries: WebFileEntry[]): WebFileEntry[] { const match = draft.match(/@([^\s@]*)$/); return match ? entries.filter((entry) => entry.kind === "file" && entry.path.toLowerCase().includes(match[1].toLowerCase())).slice(0, 6) : []; }
export function insertFileReference(draft: string, path: string): string { return draft.replace(/@[^\s@]*$/, `@${path} `); }
export function promptCommand(id: string, text: string): ClientCommand { return { id, type: "prompt", text }; }
export function isAllowedImage(file: Pick<File, "type" | "size">): boolean { return IMAGE_TYPES.has(file.type) && file.size <= IMAGE_LIMIT; }
export type TimelineRow = { id: string; kind: "user" | "assistant" | "thinking" | "tool" | "system"; text: string };
export function rowsFromSnapshot(messages: WebMessage[]): TimelineRow[] { return messages.map((message) => ({ id: message.id, kind: message.role, text: typeof message.content === "string" ? message.content : "" })); }
export function appendRow(rows: TimelineRow[], id: string, kind: TimelineRow["kind"], text: string): TimelineRow[] { const row = rows.find((item) => item.id === id && item.kind === kind); return row ? rows.map((item) => item === row ? { ...item, text: item.text + text } : item) : [...rows, { id, kind, text }]; }
