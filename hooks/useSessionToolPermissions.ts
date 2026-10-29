"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolPreset } from "@/lib/tool-presets";
import type { SessionToolPermissions } from "@/lib/tool-permissions";

interface Options {
  sessionId: string | null;
  preset: ToolPreset;
  busy: boolean;
  locked: boolean;
  load: () => Promise<boolean>;
  apply: (preset: ToolPreset) => Promise<boolean>;
}

/** Session-only changes never write the default preference. */
export function useSessionToolPermissions(options: Options): SessionToolPermissions | null {
  const [pendingPreset, setPendingPreset] = useState<ToolPreset | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = useRef(options);
  current.current = options;
  const mounted = useRef(true);
  const pending = useRef<ToolPreset | null>(null);
  const applying = useRef<object | null>(null);
  const reading = useRef<object | null>(null);
  const loadedSession = useRef<string | null>(null);
  const revision = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    pending.current = null; setPendingPreset(null); setReady(false);
    setLoading(false); setSaving(false);
    revision.current++;
    loadedSession.current = null;
    reading.current = null;
    applying.current = null;
  }, [options.sessionId]);

  const load = useCallback(async () => {
    const context = current.current;
    if (!mounted.current || !context.sessionId || reading.current || loadedSession.current === context.sessionId) return;
    const request = {};
    const version = revision.current;
    reading.current = request;
    setLoading(true);
    try {
      const ok = await context.load();
      if (mounted.current && current.current.sessionId === context.sessionId && revision.current === version) {
        loadedSession.current = ok ? context.sessionId : null;
        setReady(ok);
      }
    } finally {
      if (reading.current === request) {
        reading.current = null;
        if (mounted.current && current.current.sessionId === context.sessionId) setLoading(false);
      }
    }
  }, []);

  const change = useCallback(async (preset: ToolPreset) => {
    const context = current.current;
    if (!mounted.current || !context.sessionId || context.locked || applying.current) return;
    if (context.busy) {
      pending.current = preset === context.preset && loadedSession.current === context.sessionId ? null : preset;
      setPendingPreset(pending.current);
      return;
    }
    pending.current = null;
    if (preset === context.preset && loadedSession.current === context.sessionId) { setPendingPreset(null); return; }
    const request = {};
    revision.current++;
    applying.current = request;
    setPendingPreset(preset);
    setSaving(true);
    try {
      const ok = await context.apply(preset);
      if (mounted.current && current.current.sessionId === context.sessionId && applying.current === request && ok) {
        loadedSession.current = context.sessionId;
        setReady(true);
      }
    }
    finally {
      if (applying.current === request) {
        applying.current = null;
        if (mounted.current && current.current.sessionId === context.sessionId) { setSaving(false); setPendingPreset(null); }
      }
    }
  }, []);

  useEffect(() => {
    if (pending.current && !options.busy && !options.locked) void change(pending.current);
  }, [options.busy, options.locked, pendingPreset, change]);

  return useMemo(() => options.sessionId ? { sessionId: options.sessionId, preset: options.preset, pendingPreset, locked: options.locked, busy: options.busy, loading, ready, saving, load, change } : null,
    [options.sessionId, options.preset, options.locked, options.busy, pendingPreset, loading, ready, saving, load, change]);
}
