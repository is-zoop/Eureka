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
  const applying = useRef<string | null>(null);
  const reading = useRef<string | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    pending.current = null; setPendingPreset(null); setReady(false);
    setLoading(false); setSaving(false);
  }, [options.sessionId]);

  const load = useCallback(async () => {
    const context = current.current;
    if (!mounted.current || !context.sessionId || reading.current === context.sessionId) return;
    reading.current = context.sessionId;
    setLoading(true);
    try {
      const ok = await context.load();
      if (mounted.current && current.current.sessionId === context.sessionId) setReady(ok);
    } finally {
      if (reading.current === context.sessionId) reading.current = null;
      if (mounted.current && current.current.sessionId === context.sessionId) setLoading(false);
    }
  }, []);

  const change = useCallback(async (preset: ToolPreset) => {
    const context = current.current;
    if (!mounted.current || !context.sessionId || context.locked || applying.current === context.sessionId) return;
    if (context.busy) {
      pending.current = preset === context.preset ? null : preset;
      setPendingPreset(pending.current);
      return;
    }
    pending.current = null;
    setPendingPreset(null);
    if (preset === context.preset) return;
    applying.current = context.sessionId;
    setSaving(true);
    try { await context.apply(preset); }
    finally {
      if (applying.current === context.sessionId) applying.current = null;
      if (mounted.current && current.current.sessionId === context.sessionId) setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (pending.current && !options.busy && !options.locked) void change(pending.current);
  }, [options.busy, options.locked, pendingPreset, change]);

  return useMemo(() => options.sessionId ? { sessionId: options.sessionId, preset: options.preset, pendingPreset, locked: options.locked, busy: options.busy, loading, ready, saving, load, change } : null,
    [options.sessionId, options.preset, options.locked, options.busy, pendingPreset, loading, ready, saving, load, change]);
}
