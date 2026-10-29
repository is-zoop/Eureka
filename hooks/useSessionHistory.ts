"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentMessage, SessionHistoryPage } from "@/lib/types";
import { mergeSessionHistory, projectSessionHistory, SessionHistoryRequests } from "@/lib/session-history";

export function useSessionHistory(messages: AgentMessage[], entryIds: string[], sessionId: RefObject<string | null>) {
  const [snapshot, setSnapshot] = useState<{ page: SessionHistoryPage | null; baseline: number }>({ page: null, baseline: 0 });
  const snapshotRef = useRef(snapshot);
  const requests = useRef(new SessionHistoryRequests());
  const olderRequest = useRef<object | null>(null);
  const temporaryKeys = useRef(new WeakMap<AgentMessage, string>());
  const nextKey = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useCallback((next: typeof snapshot) => {
    snapshotRef.current = next; setSnapshot(next);
  }, []);
  const invalidate = useCallback(() => {
    requests.current.invalidate(); olderRequest.current = null;
  }, []);
  const reset = useCallback(() => {
    invalidate();
    update({ page: null, baseline: 0 }); setLoading(false); setError(null);
  }, [update, invalidate]);
  const begin = useCallback(() => requests.current.begin(), []);
  const current = useCallback((request: { epoch: number; sequence: number }) => requests.current.current(request), []);
  const apply = useCallback((page: SessionHistoryPage | undefined, baseline: number) => {
    update({ page: page ? mergeSessionHistory(snapshotRef.current.page, page) : null, baseline });
    setError(null);
  }, [update]);
  const loadEarlier = useCallback(async () => {
    const page = snapshotRef.current.page;
    const sid = sessionId.current;
    if (!sid || !page?.hasMore || !page.before || olderRequest.current) return false;
    const token = {}; olderRequest.current = token;
    const generation = requests.current.epoch;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ before: page.before });
      if (page.leafId) query.set("leafId", page.leafId);
      const response = await fetch(`/api/sessions/${encodeURIComponent(sid)}/history?${query}`);
      const data = await response.json() as { history: SessionHistoryPage; error?: string };
      if (generation !== requests.current.epoch || sessionId.current !== sid) return false;
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      const latest = snapshotRef.current;
      update({ ...latest, page: mergeSessionHistory(data.history, latest.page ?? data.history) });
      return true;
    } catch (cause) {
      if (generation === requests.current.epoch && sessionId.current === sid) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (olderRequest.current === token) { olderRequest.current = null; setLoading(false); }
    }
  }, [sessionId, update]);
  // A reconnect can skip more than one page. Fill the gap between cached
  // history and the new tail without discarding records the user already read.
  useEffect(() => {
    if ((snapshot.page?.ranges.length ?? 0) > 1 && !loading && !error) void loadEarlier();
  }, [snapshot.page, loading, error, loadEarlier]);
  const display = useMemo(() => projectSessionHistory(snapshot.page, snapshot.baseline, messages, entryIds, message => {
    let key = temporaryKeys.current.get(message);
    if (!key) { key = `live-${++nextKey.current}`; temporaryKeys.current.set(message, key); }
    return key;
  }), [snapshot, messages, entryIds]);
  return { display, hasMore: snapshot.page?.hasMore ?? false, loading, error, loadEarlier, reset, invalidate, begin, current, apply };
}
