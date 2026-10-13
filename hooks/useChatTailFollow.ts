"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { CHAT_SCROLL_REATTACH_TOLERANCE, CHAT_SCROLL_TAIL_TOLERANCE, getLiveFollowAttached } from "@/lib/chat-lazy-load";

/** Follow real content growth, including tool output, stage folds and viewport changes. */
export function useChatTailFollow({ active, ready, contentVersion }: { active: boolean; ready: boolean; contentVersion: number }) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const liveFollowFrameRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const cancelLiveFollow = useCallback(() => {
    if (liveFollowFrameRef.current !== null) {
      cancelAnimationFrame(liveFollowFrameRef.current);
      liveFollowFrameRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: Math.max(0, container.scrollHeight - container.clientHeight), behavior });
    previousScrollTopRef.current = container.scrollTop;
  }, []);

  const scheduleLiveFollow = useCallback(() => {
    if (!isNearBottomRef.current || liveFollowFrameRef.current !== null) return;
    liveFollowFrameRef.current = requestAnimationFrame(() => {
      liveFollowFrameRef.current = null;
      if (isNearBottomRef.current) scrollToBottom("auto");
    });
  }, [scrollToBottom]);

  const followTail = useCallback(() => {
    cancelLiveFollow();
    isNearBottomRef.current = true;
    scrollToBottom("auto");
  }, [cancelLiveFollow, scrollToBottom]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!ready || !container || !content) return;
    previousScrollTopRef.current = container.scrollTop;
    const handleScroll = () => {
      const wasAttached = isNearBottomRef.current;
      const { scrollTop, clientHeight, scrollHeight } = container;
      const isAttached = getLiveFollowAttached(wasAttached, previousScrollTopRef.current, scrollTop, clientHeight, scrollHeight,
        activeRef.current ? CHAT_SCROLL_REATTACH_TOLERANCE : CHAT_SCROLL_TAIL_TOLERANCE);
      isNearBottomRef.current = isAttached;
      previousScrollTopRef.current = scrollTop;
      if (!wasAttached && isAttached && activeRef.current) scheduleLiveFollow();
      else if (!isAttached) cancelLiveFollow();
    };
    const handleResize = () => {
      if (activeRef.current) scheduleLiveFollow();
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleResize);
    observer?.observe(content);
    observer?.observe(container);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
      cancelLiveFollow();
    };
  }, [ready, active, contentVersion, cancelLiveFollow, scheduleLiveFollow]);

  return { scrollContainerRef, messageContentRef, messagesEndRef, isNearBottomRef, scrollToBottom, scheduleLiveFollow, followTail };
}
