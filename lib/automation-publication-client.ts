import type { PublicationView } from "./automation-publication";

const reads = new Map<string, Promise<PublicationView>>();

/** Share only in-flight GETs, including Strict Mode effect replay. Never share mutations. */
export function loadPublicationView(url: string, fetcher: typeof fetch = fetch): Promise<PublicationView> {
  const existing = reads.get(url);
  if (existing) return existing;
  const pending = Promise.resolve().then(async () => {
    // A subscriber unmounting must not cancel a read still needed by another subscriber.
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load publication data");
    return data as PublicationView;
  }).finally(() => { if (reads.get(url) === pending) reads.delete(url); });
  reads.set(url, pending);
  return pending;
}
