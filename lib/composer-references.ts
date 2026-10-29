import type { ChatDraftReference } from "./draft-store";
import { normalizeFilePathSlashes } from "./file-paths";

export function composerReferenceText(references: ChatDraftReference[] = []): string[] {
  return references.map(reference => {
    const value = `${normalizeFilePathSlashes(reference.path)}${reference.isDir && !/[\\/]$/.test(reference.path) ? "/" : ""}`;
    return `@${/[\s"]/.test(value) ? JSON.stringify(value) : value}`;
  });
}
