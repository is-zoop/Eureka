import type { SessionArchive } from "../../../lib/types";

export async function changeSessionArchive(id: string, archived: boolean): Promise<SessionArchive | null> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/archive`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  if (response.status === 409) throw new Error("session_running");
  if (!response.ok) throw new Error("archive_failed");
  const { archive } = await response.json() as { archive: SessionArchive | null };
  return archive;
}
