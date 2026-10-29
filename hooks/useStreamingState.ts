"use client";

import { useEffect, useReducer, useState } from "react";
import { INITIAL_STREAMING_STATE, streamReducer } from "@/lib/streaming-message";
import { StreamUpdateBuffer } from "@/lib/stream-update-buffer";

export function useStreamingState() {
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const [buffer] = useState(() => new StreamUpdateBuffer(dispatch, (flush) => {
    // A bounded timer also drains background tabs where animation frames pause.
    const timer = setTimeout(flush, 50);
    const frame = requestAnimationFrame(flush);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); };
  }));
  useEffect(() => () => buffer.clear(), [buffer]);
  return [state, buffer.send] as const;
}
