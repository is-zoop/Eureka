/**
 * Per-workspace "last open session" memory.
 *
 * Switching to a workspace (project root or cwd) restores the session the user
 * had open there last, instead of landing on a blank new-session page. Without
 * this, every workspace switch required re-picking the session by hand.
 *
 * The workspace key is the resolved project root when known (sessions carry it
 * from the server), so all worktrees of one repo share a single memory slot.
 * It falls back to the raw cwd for non-repo directories, which is its own
 * project key there.
 *
 * Stored in localStorage; best-effort (silently ignored when unavailable).
 */

const STORAGE_KEY = "pi-web:last-open-by-workspace";
const SELECTED_PROJECT_STORAGE_KEY = "pi-web:last-selected-project";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readMap(storage: StorageLike): Record<string, string | undefined> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string | undefined>
      : {};
  } catch {
    return {};
  }
}

/** The remembered session id for a workspace, or null when none/stale. */
export function getLastOpenSession(
  workspaceKey: string,
  storage: StorageLike | null = getBrowserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const id = readMap(storage)[workspaceKey];
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function setLastOpenSession(
  workspaceKey: string,
  sessionId: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const map = readMap(storage);
    map[workspaceKey] = sessionId;
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearLastOpen(
  workspaceKey: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const map = readMap(storage);
    if (!(workspaceKey in map)) return;
    delete map[workspaceKey];
    // Keep the store clean: drop the key entirely when nothing is remembered.
    if (Object.keys(map).length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** The project most recently selected in the sidebar, if it is still known. */
export function getLastSelectedProject(storage: StorageLike | null = getBrowserStorage()): string | null {
  if (!storage) return null;
  try {
    const project = storage.getItem(SELECTED_PROJECT_STORAGE_KEY);
    return typeof project === "string" && project.length > 0 ? project : null;
  } catch {
    return null;
  }
}

export function setLastSelectedProject(project: string, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage || !project) return;
  try {
    storage.setItem(SELECTED_PROJECT_STORAGE_KEY, project);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearLastSelectedProject(project: string, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    if (storage.getItem(SELECTED_PROJECT_STORAGE_KEY) === project) storage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

/** Workspace identity for a session: resolved project root when known, else cwd. */
export function workspaceKeyOf(session: {
  cwd: string;
  projectRoot?: string | null;
}): string {
  return session.projectRoot ?? session.cwd;
}
