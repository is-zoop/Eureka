"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const EXIT_TIMEOUT = 250;

/** Animate natural height while keeping expensive closed details unmounted. */
export function Collapse({ open, children, keepMounted = false, className = "" }: {
  open: boolean;
  children: ReactNode | (() => ReactNode);
  keepMounted?: boolean;
  className?: string;
}) {
  const [present, setPresent] = useState(open || keepMounted);
  const [expanded, setExpanded] = useState(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !rootRef.current?.contains(active)) returnFocusRef.current = active;
      setPresent(true);
      if (reducedMotion) setExpanded(true);
      else {
        // Commit the mounted content at 0fr before transitioning to its height.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setExpanded(true));
        });
      }
    } else {
      if (rootRef.current?.contains(document.activeElement)) {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
        else (document.activeElement as HTMLElement | null)?.blur();
      }
      setExpanded(false);
      if (!keepMounted) {
        if (reducedMotion) setPresent(false);
        else timer = setTimeout(() => setPresent(false), EXIT_TIMEOUT);
      }
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [open, keepMounted]);

  const visible = open && expanded;
  return <div ref={rootRef} className={`ui-collapse ${className}`.trim()}
    style={{ gridTemplateRows: visible ? "1fr" : "0fr" }} data-open={visible}
    aria-hidden={!visible} inert={!visible}
    onTransitionEnd={(event) => {
      if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !open && !keepMounted) setPresent(false);
    }}>
    <div className="ui-collapse-inner">
      {(present || keepMounted) && (typeof children === "function" ? children() : children)}
    </div>
  </div>;
}
