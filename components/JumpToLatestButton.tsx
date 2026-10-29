"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { isScrollAtTail } from "@/lib/chat-lazy-load";
import { useI18n } from "@/hooks/useI18n";
import { LabelTooltip } from "./LabelTooltip";

/** Keep scroll-driven visibility local, without re-rendering the message list. */
export function JumpToLatestButton({ scrollContainer, content, ready, rightInset, onJump }: {
  scrollContainer: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  ready: boolean;
  rightInset: number;
  onJump: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const container = scrollContainer.current;
    if (!ready || !container) return;
    const update = () => setVisible(!isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight));
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    if (content.current) observer?.observe(content.current);
    return () => {
      container.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [scrollContainer, content, ready]);

  if (!ready || !visible) return null;
  return (
    <div className="chat-jump-to-latest" style={{ right: rightInset }}>
      <LabelTooltip content={t("chat.jumpToLatest")}>
        <button type="button" className="chat-jump-to-latest-button" aria-label={t("chat.jumpToLatest")} onClick={onJump}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14m-6-6 6 6 6-6" />
          </svg>
        </button>
      </LabelTooltip>
    </div>
  );
}
