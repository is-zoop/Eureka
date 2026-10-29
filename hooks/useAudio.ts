"use client";

import { useRef, useCallback, useEffect } from "react";
import { getCompletionSoundPreference, subscribeCompletionSoundPreference } from "@/lib/completion-sound-preference";

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

export function useAudio() {
  // Reuse a single AudioContext so it can be resumed if the browser
  // autoplay policy suspends it (contexts created outside user gestures
  // start in "suspended" state and produce no sound).
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !getCompletionSoundPreference()) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().catch(() => {});
  }, [getCtx]);

  // A same-window settings change still runs in the switch's user gesture,
  // so enabling sound can also unlock the existing AudioContext.
  useEffect(() => subscribeCompletionSoundPreference(() => {
    unlockAudio();
  }), [unlockAudio]);

  const playDone = useCallback(() => {
    if (!getCompletionSoundPreference()) return;
    const ctx = getCtx();
    if (!ctx) return;
    const play = () => {
      // The global switch may have changed while resume() was pending.
      if (!getCompletionSoundPreference()) return;
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, [getCtx]);

  return { playDoneSound: playDone, unlockAudio };
}
