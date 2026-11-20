import { getSessionEntries, resolveSessionPath } from "./session-reader";
export { isFilePathReferencedByEntries } from "../shared/session-file-references-core";
import {
  isBashOutputPathReferencedByEntries,
  isFilePathReferencedByEntries,
  isValidSessionId,
} from "../shared/session-file-references-core";

export async function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isFilePathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}

export async function isBashOutputPathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isBashOutputPathReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}
