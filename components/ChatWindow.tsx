"use client";

import { NotificationNotice } from "@/components/Notifications";

import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, CustomMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage, UserMessage } from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { buildTaskPhases, type TaskPhaseSource } from "@/lib/task-phases";
import { extractTurnWrittenFiles, type WrittenFile } from "@/lib/turn-written-files";
import { MessageView } from "./MessageView";
import { TaskTurnView } from "./TaskTurnView";
import { AgentActivityStatus } from "./AgentActivity";
import { PlanCard } from "./PlanCard";
import { PlanQuestionCard } from "./PlanQuestionCard";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Skeleton } from "./ui/skeleton";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ChatDraftReference } from "@/lib/draft-store";
import { getPendingPlanQuestionGroup, getSessionPlans, isDraftPlanEntry, type EurekaPlanAnnotation, type EurekaPlanQuestion, type EurekaPlanState } from "@/lib/plan-mode";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";

interface Props {
  session: SessionInfo | null;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  onAgentEnd?: () => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemPromptLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenComposerReference?: (reference: ChatDraftReference) => void;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
  onPlanStateChange?: (plan: EurekaPlanState, controls: PlanReviewControls) => void;
  onOpenPlanReview?: (plan: EurekaPlanState, controls: PlanReviewControls, readOnly?: boolean) => void;
  onContentLoadingChange?: (loading: boolean) => void;
}

export interface PlanReviewControls {
  update: (annotations: EurekaPlanAnnotation[], generalNote: string) => Promise<unknown>;
  returnForRevision: () => Promise<unknown>;
  approve: () => Promise<unknown>;
  abandon: () => Promise<unknown>;
}

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function getPlanQuestionsForMessage(message: AgentMessage, questions: EurekaPlanQuestion[]): EurekaPlanQuestion[] {
  if (message.role !== "assistant") return [];
  const toolCallIds: string[] = [];
  for (const block of (message as AssistantMessage).content) {
    if (block.type === "toolCall" && block.toolName === "request_user_input") {
      toolCallIds.push(block.toolCallId);
    }
  }
  return toolCallIds.flatMap((toolCallId) => questions.filter((question) => question.toolCallId === toolCallId));
}

function groupPlanQuestions(questions: EurekaPlanQuestion[]): EurekaPlanQuestion[][] {
  const groups = new Map<string, EurekaPlanQuestion[]>();
  for (const question of questions) {
    const group = groups.get(question.toolCallId) ?? [];
    group.push(question);
    groups.set(question.toolCallId, group);
  }
  return [...groups.values()];
}

// A user message normally anchors a turn (user prompt → process → final
// answer), and the process messages in between get folded into a collapsed
// ProcessDetailsGroup. When compaction fires mid-turn, pi drops the original
// user prompt and inserts a compaction summary (role "custom", customType
// "compaction") in its place; the agent then keeps producing tool calls and a
// final answer with no user message left to anchor them. Treat a compaction
// summary as an anchor too, otherwise every post-compaction message renders
// standalone and never collapses.
function isGroupAnchor(message: AgentMessage): boolean {
  if (message.role === "user") return true;
  return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

export function ChatWindow({ session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile, onOpenComposerReference, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio, onPlanStateChange, onOpenPlanReview, onContentLoadingChange }: Props) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages, planMode,
    extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef, messageContentRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
    handlePlanModeChange, handleSubmitPlan, handlePlanQuestionAnswer, handlePlanReviewUpdate, handleReturnPlanForRevision, handleApprovePlan, handleAbandonPlan,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd: wrappedOnAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsPanelOpen,
  });

  useEffect(() => {
    onContentLoadingChange?.(loading);
  }, [loading, onContentLoadingChange]);

  const planReviewControls = useMemo<PlanReviewControls>(() => ({
    update: handlePlanReviewUpdate,
    returnForRevision: handleReturnPlanForRevision,
    approve: handleApprovePlan,
    abandon: handleAbandonPlan,
  }), [handlePlanReviewUpdate, handleReturnPlanForRevision, handleApprovePlan, handleAbandonPlan]);

  useEffect(() => {
    onPlanStateChange?.(planMode, planReviewControls);
  }, [onPlanStateChange, planMode, planReviewControls]);
  const sessionBusy = agentRunning || bashRunning;
  const runningToolIds = useMemo<ReadonlySet<string>>(() => new Set(
    agentPhase?.kind === "running_tools" ? agentPhase.tools.map((tool) => tool.id) : [],
  ), [agentPhase]);

  useEffect(() => {
    if (!extensionDialog || soundedExtensionDialogIdRef.current === extensionDialog.id) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);

  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          // Save distance from top before prepending to restore scroll later
          prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
          setVisibleCount((prev) => getNextVisibleCount(prev));
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, messages.length, scrollContainerRef]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    prevScrollDistanceRef.current = null;
  }, [visibleCount, scrollContainerRef]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  // Only the newest assistant response can belong to the currently active
  // planning turn. Older replies are session history, never resubmittable plans.
  const latestAssistantMessageIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") return index;
    }
    return -1;
  }, [messages]);
  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamState), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);
  const revealHistoryForMinimap = useCallback(() => {
    setVisibleCount((current) => Math.max(current, messages.length * 2));
  }, [messages.length]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const hasStreamingContent = Boolean(streamState.streamingMessage?.content.length);
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;
  const pendingPlanQuestions = getPendingPlanQuestionGroup(planMode);

  const planQuestionElement = pendingPlanQuestions.length > 0 ? (
    <div style={{ flexShrink: 0, padding: "0 16px 1px", paddingRight: isMobile ? 16 : CHAT_INPUT_RIGHT_PADDING }}>
      <div style={{ width: "100%", maxWidth: 820, margin: "0 auto" }}>
        <PlanQuestionCard questions={pendingPlanQuestions} onAnswer={handlePlanQuestionAnswer} />
      </div>
    </div>
  ) : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      inputLocked={planMode.questions.some((question) => question.status === "pending")}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      planMode={planMode}
      onPlanModeChange={session || isNew ? handlePlanModeChange : undefined}
      onCancelPlan={session || isNew ? handleAbandonPlan : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
      onOpenReference={onOpenComposerReference}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[var(--chat-bg)]" role="status" aria-busy="true" aria-label={t("chat.loadingSession")}>
        <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-7 overflow-hidden px-6 py-8">
          <div className="flex max-w-[74%] flex-col gap-3"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-4/5" /><Skeleton className="h-3 w-16" /></div>
          <div className="ml-auto flex w-[min(70%,30rem)] flex-col gap-3 rounded-2xl bg-[var(--bg-panel)] p-4"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-3/4" /><Skeleton className="ml-auto h-3 w-14" /></div>
          <div className="flex max-w-[62%] flex-col gap-3"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-12" /></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <NotificationNotice message={error} type="error" />
    );
  }

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", background: "var(--chat-bg)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-[820px]">
            <div className="mb-16 flex flex-col items-center px-4 text-center text-[var(--text)]">
              <div className="flex items-center justify-center gap-4">
                <img
                  src={isDark ? "/icons/logo-white-transparent.png" : "/icons/logo-black-transparent.png"}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{ width: isMobile ? 58 : 76, height: isMobile ? 58 : 76, objectFit: "contain", flex: "0 0 auto" }}
                />
                <h1 style={{ margin: 0, fontSize: isMobile ? 28 : 32, fontWeight: 750, letterSpacing: "-0.04em", lineHeight: 1.15 }}>
                  将灵感付诸行动吧！
                </h1>
              </div>
              <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: isMobile ? 14 : 16, lineHeight: 1.5 }}>
                在这里，和 Eureka 一起把想法变成现实。
              </p>
            </div>
            {planQuestionElement}
            {chatInputElement}
            <ExtensionStatusBar statuses={extensionStatuses} widgets={extensionWidgets} />
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <div ref={scrollContainerRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-4 [scrollbar-width:none]">
          <div style={{ minWidth: 0, minHeight: "100%", display: "flex", flexDirection: "column", padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div ref={messageContentRef} style={{ width: "100%", minWidth: 0, maxWidth: 820, margin: "0 auto", flex: "1 0 auto", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            {(() => {
              let streamingConsumed = false;
              // Compaction summaries may anchor a live segment after the last user prompt.
              let lastAnchorIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (isGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
              }

              const visibleRefIndexByMessage = new Map<number, number>();
              let refIdx = 0;
              messages.forEach((msg, idx) => {
                if (msg.role === "user" || msg.role === "assistant") {
                  visibleRefIndexByMessage.set(idx, refIdx++);
                }
              });

              const attachVisibleRef = (refIndex: number) => (el: HTMLDivElement | null) => {
                messageRefs.current[refIndex] = el;
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[]; renderPlan?: boolean; isStreaming?: boolean } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                    ? entryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                const messageView = (
                  <MessageView
                    key={`${keyPrefix}-view-${idx}`}
                    message={msg}
                    isStreaming={options.isStreaming}
                    toolResults={toolResultsMap}
                    runningToolIds={runningToolIds}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenReference={onOpenComposerReference}
                    entryId={entryIds[idx]}
                    onFork={sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={sessionBusy ? undefined : handleNavigate}
                    prevAssistantEntryId={sessionBusy ? undefined : prevAssistantEntryId}
                    onEditContent={handleEditContent}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    writtenFiles={options.writtenFiles}
                  />
                );
                const canSubmitPlan = planMode.planModeActive
                  && planMode.phase === "planning"
                  && msg.role === "assistant"
                  && (msg as AssistantMessage).stopReason !== "error"
                  && (msg as AssistantMessage).stopReason !== "aborted"
                  && idx === latestAssistantMessageIndex
                  && isDraftPlanEntry(planMode, entryIds, idx)
                  && !sessionBusy
                  && Boolean(onOpenPlanReview)
                  && getAssistantText(msg as AssistantMessage).length > 0;
                // A final assistant entry may be rendered twice: once for its
                // thinking/tool process and once for its final text. The plan
                // belongs to the final text only, never the process duplicate.
                const sourcePlan = options.renderPlan === false || !entryIds[idx]
                  ? undefined
                  : getSessionPlans(planMode).find((plan) => plan.sourceEntryId === entryIds[idx]);
                // A plan is editable only when both its stable record id and
                // source assistant message match the active plan. The source
                // check also protects legacy snapshots that may share an id.
                const sourcePlanIsCurrent = sourcePlan?.activePlanId === planMode.activePlanId
                  && sourcePlan?.sourceEntryId === planMode.sourceEntryId;
                // Every persisted plan remains inspectable after plan mode ends.
                // Only the active review may open with editing controls; archived,
                // stopped, and executed plans always use the read-only view.
                const currentPlanAction = Boolean(sourcePlan && onOpenPlanReview);
                const planQuestionGroups = groupPlanQuestions(getPlanQuestionsForMessage(msg, planMode.questions)
                  .filter((question) => question.status === "answered"));
                const planMarkdown = sourcePlan?.content ?? (canSubmitPlan ? getAssistantText(msg as AssistantMessage) : "");
                const planPrimaryAction = canSubmitPlan ? {
                  label: t("plan.submitReview"),
                  onClick: async () => {
                    const next = await handleSubmitPlan(planMarkdown, entryIds[idx]);
                    if (next) onOpenPlanReview?.(next, planReviewControls);
                  },
                } : currentPlanAction && sourcePlan ? {
                  label: sourcePlanIsCurrent && sourcePlan.phase === "reviewing" ? t("plan.openReview") : t("plan.view"),
                  onClick: () => onOpenPlanReview?.(sourcePlan, planReviewControls, !sourcePlanIsCurrent || sourcePlan.phase !== "reviewing"),
                } : undefined;
                const content = planMarkdown ? (
                  <PlanCard
                    id={sourcePlan?.activePlanId ?? `draft-${entryIds[idx] ?? idx}`}
                    markdown={planMarkdown}
                    revision={sourcePlan?.revision}
                    defaultCollapsed={!canSubmitPlan && !sourcePlanIsCurrent}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    primaryAction={planPrimaryAction}
                  />
                ) : messageView;
                const view = planQuestionGroups.length > 0 ? (
                  <div>
                    {content}
                    {planQuestionGroups.map((questions) => (
                      <PlanQuestionCard
                        key={questions[0]?.toolCallId}
                        questions={questions}
                        readOnly
                      />
                    ))}
                  </div>
                ) : content;
                if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
                return (
                  <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(currentRefIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                if (!isGroupAnchor(msg)) {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) endIdx += 1;

                const isLiveTail = (agentRunning || streamState.isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
                if (isLiveTail) streamingConsumed = true;
                const assistantIndices: number[] = [];
                const extraIndices: number[] = [];
                const sources: TaskPhaseSource[] = [];
                for (let sourceIdx = userIdx + 1; sourceIdx < endIdx; sourceIdx++) {
                  const sourceMessage = messages[sourceIdx];
                  if (sourceMessage.role === "assistant") {
                    assistantIndices.push(sourceIdx);
                    sources.push({ message: sourceMessage as AssistantMessage, messageIndex: sourceIdx, entryId: entryIds[sourceIdx] });
                  } else if (sourceMessage.role !== "toolResult") {
                    extraIndices.push(sourceIdx);
                  }
                }
                if (isLiveTail && streamState.isStreaming && streamState.streamingMessage) {
                  sources.push({ message: streamState.streamingMessage, messageIndex: messages.length, isStreaming: true });
                  streamingConsumed = true;
                }
                const protectedPlanIndices = new Set(assistantIndices.filter((sourceIdx) =>
                  entryIds[sourceIdx] && getSessionPlans(planMode).some((plan) => plan.sourceEntryId === entryIds[sourceIdx])
                  && getAssistantText(messages[sourceIdx] as AssistantMessage).length > 0));
                const turn = buildTaskPhases(sources, {
                  running: isLiveTail,
                  toolResults: toolResultsMap,
                  runningToolIds,
                  summaryExcludedMessageIndices: protectedPlanIndices,
                });
                rendered.push(renderMessage(userIdx));
                if (turn.phases.length > 0 || (sources.length > 0 && turn.status !== "completed" && turn.status !== "running")) {
                  const tail = sources.at(-1);
                  const turnKey = (entryIds[userIdx] ?? String(userIdx)) + ":" + (isLiveTail ? "live" : tail?.entryId ?? String(tail?.message.timestamp ?? endIdx));
                  rendered.push(<div key={"task-turn-" + turnKey} ref={(element) => {
                    for (const sourceIdx of assistantIndices) {
                      const refIndex = visibleRefIndexByMessage.get(sourceIdx);
                      if (refIndex === undefined) continue;
                      const current = messageRefs.current[refIndex];
                      if (element && current && element.contains(current)) continue;
                      messageRefs.current[refIndex] = element;
                    }
                  }}>
                    <TaskTurnView turn={turn} toolResults={toolResultsMap} runningToolIds={runningToolIds}
                      agentPhase={isLiveTail ? agentPhase : null}
                      cwd={messageCwd} onOpenFile={onOpenFile} sessionId={session?.id ?? sessionIdRef.current ?? undefined} modelNames={modelNames}
                      phaseRef={(phase) => (element) => {
                        for (const sourceIdx of new Set([...phase.summary, ...phase.items].map((ref) => ref.source.messageIndex))) {
                          const refIndex = visibleRefIndexByMessage.get(sourceIdx);
                          if (refIndex !== undefined) messageRefs.current[refIndex] = element;
                        }
                      }}
                      renderExtras={(phase) => {
                        const phaseIndex = turn.phases.indexOf(phase);
                        const next = turn.phases[phaseIndex + 1];
                        const start = phaseIndex === 0 ? userIdx : Math.min(...[...phase.summary, ...phase.items].map((ref) => ref.source.messageIndex));
                        const end = next ? Math.min(...[...next.summary, ...next.items].map((ref) => ref.source.messageIndex)) : endIdx;
                        const indices = new Set([...phase.summary, ...phase.items].map((ref) => ref.source.messageIndex));
                        const phaseToolIds = new Set(phase.items.flatMap((ref) => ref.block.type === "toolCall" ? [ref.block.toolCallId] : []));
                        return <>
                          {extraIndices.filter((sourceIdx) => sourceIdx >= start && sourceIdx < end).map((sourceIdx) => renderMessage(sourceIdx, { attachRef: false }))}
                          {[...indices].filter((sourceIdx) => sourceIdx < messages.length && !protectedPlanIndices.has(sourceIdx)).flatMap((sourceIdx) =>
                            groupPlanQuestions(getPlanQuestionsForMessage(messages[sourceIdx], planMode.questions).filter((question) => question.status === "answered" && phaseToolIds.has(question.toolCallId)))
                              .map((questions) => <PlanQuestionCard key={questions[0]?.toolCallId} questions={questions} readOnly />))}
                        </>;
                      }} />
                  </div>);
                } else {
                  for (const sourceIdx of extraIndices) rendered.push(renderMessage(sourceIdx));
                }
                for (const sourceIdx of protectedPlanIndices) {
                  if (sourceIdx !== turn.answerSource?.messageIndex) rendered.push(renderMessage(sourceIdx));
                }
                if (turn.answerSource) {
                  const finalAssistant = turn.answerSource.message;
                  const finalAnswer = withAssistantBlocks(finalAssistant, turn.answerBlockIndices.map((blockIndex) => finalAssistant.content[blockIndex]));
                  const turnContent = sources.flatMap((source) => source.message.content ?? []);
                  const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
                  rendered.push(renderMessage(turn.answerSource.messageIndex, {
                    messageOverride: finalAnswer, writtenFiles, isStreaming: turn.answerSource.isStreaming,
                    keyPrefix: "final-answer",
                  }));
                }
                idx = endIdx;
              }
              const { startIndex, hasMore } = getVisibleRenderWindow(rendered.length, visibleCount);
              return (
                <>
                  {hasMore && (
                     <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
                       {t("chat.loadEarlier", { count: startIndex })}
                    </div>
                  )}
                  {rendered.slice(startIndex)}
                  {!streamingConsumed && streamState.isStreaming && hasStreamingContent && streamState.streamingMessage && (
                    <MessageView message={streamState.streamingMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} sessionId={session?.id ?? sessionIdRef.current ?? undefined} />
                  )}
                  {!streamingConsumed && agentRunning && !hasStreamingContent && agentPhase && (
                    <div className="py-2 text-[13px] text-text-muted"><AgentActivityStatus phase={agentPhase} /></div>
                  )}
                </>
              );
            })()}
            {bashRunning && !pendingBash && (
              <div className="py-2 text-[13px] text-text-muted">
                <AgentActivityStatus phase={{ kind: "running_command" }} />
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
        {isMobile ? null : (
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            onRevealHistory={revealHistoryForMinimap}
          />
        )}
      </div>

      <div className="relative">
        {planQuestionElement}
        {chatInputElement}
        <ExtensionStatusBar statuses={extensionStatuses} widgets={extensionWidgets} />
      </div>
      </>
      )}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-popover)",
          background: "var(--bg-panel)",
          boxShadow: "var(--shadow-floating)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em" }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{t("chat.extensionRequest")}</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(request, { value: option })}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: "var(--radius-control)",
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 14,
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 14,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 14,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
             {t("chat.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
               {t("chat.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
               {t("chat.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
           <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>{t("chat.extensionPanel")}</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
             {t("chat.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
