import type { SessionInfo } from "./types";

export const DESKTOP_TRAY_ACTION_EVENT = "desktop-tray-action";
export const RECENT_TRAY_SESSION_LIMIT = 3;

/** Use the same session list as the sidebar; never read or start sessions here. */
export function getRecentTraySessions(sessions: SessionInfo[]): SessionInfo[] {
  const seen = new Set<string>();
  return [...sessions]
    .sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0))
    .filter((session) => {
      if (!session.id || seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .slice(0, RECENT_TRAY_SESSION_LIMIT);
}
