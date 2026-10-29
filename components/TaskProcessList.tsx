"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export const PROCESS_VISIBLE_ROWS = 12;

/** Keep process history compact, following live work and opening history at its start. */
export function TaskProcessList({ running, children }: { running: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = running ? viewport.scrollHeight : 0;
  }, [running]);

  useLayoutEffect(() => {
    // A new entry or updated thinking must reveal the newest row even if the
    // user previously scrolled up. Completed history retains manual scrolling.
    const viewport = viewportRef.current;
    if (running && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [children, running]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!running || !viewport || !content) return;
    let frame: number | null = null;
    const follow = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        viewport.scrollTop = viewport.scrollHeight;
      });
    };
    // Includes async thinking details and the enclosing collapse animation.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(follow);
    observer?.observe(content);
    observer?.observe(viewport);
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [running]);

  return <div ref={viewportRef} className="task-process-list" role="region" tabIndex={0}
    aria-label={t("taskPhase.processList")} data-running={running} data-visible-rows={PROCESS_VISIBLE_ROWS}>
    <div ref={contentRef} className="task-process-list-items">{children}</div>
  </div>;
}
