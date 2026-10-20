import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const sessionRouteSource = (await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const chatWindowSource = (await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const chatInputSource = (await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const appShellSource = (await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("restores persisted plan snapshots when opening a closed session", () => {
  assert.match(sessionRouteSource, /const planMode = readPlanState\(entries as never\)/);
  assert.match(sessionRouteSource, /context,\n\s*planMode,/);
  assert.match(source, /if \(d\.planMode !== undefined\) setPlanMode\(d\.planMode\)/);
});

test("submits a normalized plan so live sessions also receive verification checklists", () => {
  assert.match(source, /type: "submit_plan", content: normalizePlanForReview\(content\), sourceEntryId/);
});

test("syncs plan progress from the live streaming assistant message", () => {
  const planProgressSource = source.slice(
    source.indexOf("  useEffect(() => {\n    if (planMode.phase !== \"executing\")"),
    source.indexOf("\n  return {", source.indexOf("  useEffect(() => {\n    if (planMode.phase !== \"executing\")")),
  );
  assert.match(planProgressSource, /streamState\.streamingMessage \?\?/);
  assert.match(planProgressSource, /getPlanDoneIndexes\(text\)\.join\(","\)/);
  assert.match(planProgressSource, /requestId === planProgressRequestRef\.current/);
});

test("keeps the session event stream open through the idle grace window", () => {
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(agentSettledSource, /onAgentEnd\?\.\(\)/);
  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /const definitivelyRejected = !promptRequestStarted/);
  assert.match(sendSource, /if \(!definitivelyRejected && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /restoreSubmission\(message, images, (?:references, )?composerDraftKey(?:, selectedPlugins)?\);[\s\S]*?if \(sentSessionId\) \{[\s\S]*?reconcileAgentState\(sentSessionId\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
  assert.doesNotMatch(
    sendSource,
    /rpcPromptPendingRef\.current = false;\s*agentRunningRef\.current = false;\s*closeEvents\(\)/,
  );
});

test("a rejected submission preserves a different run reported by the server", () => {
  const reconcileSource = source.slice(
    source.indexOf("  const reconcileAgentState = useCallback"),
    source.indexOf("  // Recovery net for missed SSE events"),
  );

  assert.match(reconcileSource, /sessionIdRef\.current !== sid/);
  assert.match(reconcileSource, /if \(busy\) \{[\s\S]*?sdkAgentActiveRef\.current = Boolean\(state\.isStreaming\)/);
  assert.match(reconcileSource, /rpcPromptPendingRef\.current = Boolean\(state\.isPromptRunning\)/);
  assert.match(reconcileSource, /if \(!agentRunningRef\.current\) return;[\s\S]*?finishPromptWithoutStream/);
});

test("opening System lazily starts a dormant session without sending a prompt", () => {
  const loadSystemPromptSource = source.slice(
    source.indexOf("  const loadSystemPrompt = useCallback"),
    source.indexOf("  const loadSlashCommands = useCallback"),
  );
  const loaderEffectSource = source.slice(
    source.indexOf("  useEffect(() => {\n    onSystemPromptLoaderChange"),
    source.indexOf("  useEffect(() => {\n    if (!onBranchDataChange) return;"),
  );

  assert.match(loadSystemPromptSource, /sessionIdRef\.current \?\? await ensureNewSession\(\)/);
  assert.doesNotMatch(loadSystemPromptSource, /promoteNewSession\(\)/);
  assert.match(loadSystemPromptSource, /sendAgentCommand<AgentStateResponse>\(sid, \{ type: "get_state" \}\)/);
  assert.doesNotMatch(loadSystemPromptSource, /type: "prompt"/);
  assert.match(loadSystemPromptSource, /setSystemPrompt\(state\.systemPrompt \?\? ""\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(loadSystemPrompt\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(null\)/);
  assert.match(appShellSource, /onClick=\{\(\) => handleSystemPromptToggle\(mobile\)\}/);
  assert.match(appShellSource, /systemPromptLoaderRef\.current/);
  assert.doesNotMatch(appShellSource, /systemPrompt !== null \|\| systemPromptLoading/);
  assert.match(appShellSource, /const loadId = \+\+systemPromptLoadIdRef\.current/);
  assert.match(appShellSource, /systemPromptLoadIdRef\.current === loadId/);
  assert.match(
    appShellSource,
    /handleSystemPromptLoaderChange[\s\S]*?systemPromptLoadIdRef\.current \+= 1;[\s\S]*?setSystemPromptLoading\(false\)/,
  );
});

test("new-session promotion rekeys drafts before publishing the real session", () => {
  const promoteSource = source.slice(
    source.indexOf("  const promoteNewSession = useCallback"),
    source.indexOf("  const ensureNewSession = useCallback"),
  );

  assert.match(promoteSource, /draftKeyAliasesRef\.current\.set\(provisionalDraftKey, sid\)/);
  assert.match(promoteSource, /input\.rekeyDraft\(provisionalDraftKey, sid\)/);
  assert.ok(
    promoteSource.indexOf("input.rekeyDraft(provisionalDraftKey, sid)")
      < promoteSource.indexOf("onSessionCreated?.({"),
  );
  assert.match(promoteSource, /}, provisionalDraftKey\)/);
  assert.match(chatWindowSource, /draftKey=\{session\?\.id \?\? newSessionDraftKey \?\? undefined\}/);
});

test("fresh sessions restore the preferred tool preset without overriding existing sessions", () => {
  const preferenceSource = source.slice(
    source.indexOf("  const setToolPresetState"),
    source.indexOf("  const scrollToBottom"),
  );
  const loadToolsSource = source.slice(
    source.indexOf("  const loadTools = useCallback"),
    source.indexOf("  const promoteNewSession"),
  );
  const changeSource = source.slice(
    source.indexOf("  const handleToolPresetChange = useCallback"),
    source.indexOf("  const scrollUserMsgToTop"),
  );

  assert.match(
    preferenceSource,
    /useLayoutEffect\(\(\) => \{\s*if \(!isNew \|\| sessionIdRef\.current\) return;\s*setToolPresetState\(getPreferredToolPreset\(\)\)/,
  );
  assert.doesNotMatch(changeSource, /setPreferredToolPreset/);
  assert.match(changeSource, /sendAgentCommand\(sid, \{ type: "set_tools", toolNames \}\)/);
  assert.doesNotMatch(loadToolsSource, /setPreferredToolPreset/);
});

test("planning's temporary read-only tools never replace the normal preset", () => {
  const loadToolsSource = source.slice(
    source.indexOf("  const loadTools = useCallback"),
    source.indexOf("  const promoteNewSession"),
  );
  const planControlsSource = source.slice(
    source.indexOf("  const handlePlanModeChange = useCallback"),
    source.indexOf("  const scrollUserMsgToTop"),
  );

  assert.match(source, /function planToolsAreTemporarilyRestricted/);
  assert.match(loadToolsSource, /options: \{ preservePreset\?: boolean \} = \{\}/);
  assert.match(loadToolsSource, /tools && !options\.preservePreset/);
  assert.match(source, /preservePreset: planToolsAreTemporarilyRestricted\(agentState\.state\?\.planMode\)/);
  assert.match(planControlsSource, /cancel_plan[\s\S]*?setPlanMode\(next\);\s*await loadTools\(sid\)/);
  assert.match(planControlsSource, /approve_plan[\s\S]*?setPlanMode\(next\);\s*await loadTools\(sid\)/);
});

test("submission recovery updates live refs before a possible session rekey", () => {
  const restoreMethod = chatInputSource.slice(
    chatInputSource.indexOf("    restoreSubmission(text:"),
    chatInputSource.indexOf("    insertText(text:"),
  );

  assert.ok(
    restoreMethod.indexOf("valueRef.current = restoredDraft.value")
      < restoreMethod.indexOf("setValue((current) =>"),
  );
  assert.ok(
    restoreMethod.indexOf("attachedImagesRef.current = restoredImages")
      < restoreMethod.indexOf("setAttachedImages((current) =>"),
  );
});

test("stale fresh-session completion cannot replace the active composer", () => {
  const cwdChangeSource = appShellSource.slice(
    appShellSource.indexOf("  const handleCwdChange = useCallback"),
    appShellSource.indexOf("  const handleSelectSession = useCallback"),
  );
  const newSessionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleNewSession = useCallback"),
    appShellSource.indexOf("  // Global keyboard shortcuts"),
  );
  const createdSource = appShellSource.slice(
    appShellSource.indexOf("  const handleSessionCreated = useCallback"),
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
  );

  assert.match(newSessionSource, /const draftKey = `new:\$\{sessionId\}:\$\{cwd\}`/);
  assert.match(newSessionSource, /activeNewSessionDraftKeyRef\.current = draftKey/);
  assert.match(createdSource, /activeNewSessionDraftKeyRef\.current !== sourceDraftKey/);
  assert.match(cwdChangeSource, /const currentFreshCwd = newSessionCwd \?\? activeCwd/);
  assert.match(
    cwdChangeSource,
    /currentProject === newProject\s*&& \(selectedSession !== null \|\| currentFreshCwd === cwd\)/,
  );
  assert.match(cwdChangeSource, /if \(currentProject !== newProject\) \{[\s\S]*?setFileTabs\(\[\]\)/);
  assert.match(
    appShellSource,
    /useLayoutEffect\(\(\) => \{\s*activeNewSessionDraftKeyRef\.current = newSessionDraftKey;/,
  );
  assert.ok(
    createdSource.indexOf("activeNewSessionDraftKeyRef.current !== sourceDraftKey")
      < createdSource.indexOf("setSelectedSession(session)"),
  );
});

test("abandoned fresh-session drafts are cleared and cannot be recreated by late rejection", () => {
  const restoreSource = source.slice(
    source.indexOf("  const restoreSubmission = useCallback"),
    source.indexOf("  const sessionStats = useMemo"),
  );
  const mountSource = source.slice(
    source.indexOf("  // Load session on mount"),
    source.indexOf("  useEffect(() => {\n    onSystemPromptChange"),
  );

  assert.match(restoreSource, /!sessionHookMountedRef\.current[\s\S]*?!newSessionPromotedRef\.current/);
  assert.match(mountSource, /const abandonedDraftKey = isNew \? newSessionDraftKey : null/);
  assert.match(mountSource, /clearDraft\(abandonedDraftKey\)/);
});

test("streaming submissions cannot be stranded in an idle direct queue", () => {
  const queueSource = source.slice(
    source.indexOf("  // Let AgentSession.prompt decide atomically"),
    source.indexOf("  const handleAbortCompaction"),
  );

  assert.match(queueSource, /type: "prompt"/);
  assert.match(queueSource, /streamingBehavior: behavior/);
  assert.match(queueSource, /if \(!promptRequestStarted \|\| isPromptRejectedError\(e\)\) \{[\s\S]*?rememberClarificationSubmission[\s\S]*?restore\(\)/);
  assert.doesNotMatch(queueSource, /type: "steer"/);
  assert.doesNotMatch(queueSource, /type: "follow_up"/);
});

test("post-accept prompt errors do not duplicate the user submission", () => {
  const promptErrorSource = source.slice(
    source.indexOf('case "prompt_error"'),
    source.indexOf('case "extension_error"'),
  );

  assert.match(promptErrorSource, /addNotice/);
  assert.doesNotMatch(promptErrorSource, /restoreSubmission/);
});

test("delegates event stream readiness and hides an empty agent phase", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(source, /new AgentEventConnection\(\{/);
  assert.match(source, /shouldMaintain: \(sid\)[\s\S]*?sessionIdRef\.current === sid/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.ensureConnected\(sid\)/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.maintain\(sid\)/);
  assert.match(chatWindowSource, /const hasStreamingContent = Boolean\(streamState\.streamingMessage\?\.content\.length\)/);
  assert.match(chatWindowSource, /streamState\.isStreaming && hasStreamingContent && streamState\.streamingMessage/);
  assert.match(chatWindowSource, /agentRunning && !hasStreamingContent && agentPhase/);
  assert.match(chatWindowSource, /return null;/);
});

test("uses one absolute agent-readiness deadline instead of a five-second transport deadline", () => {
  assert.match(source, /EVENT_STREAM_READY_TIMEOUT_MS = 60_000/);
  assert.doesNotMatch(source, /EVENT_STREAM_OPEN_TIMEOUT_MS/);
});

test("connects a selected session when another browser reports it running", () => {
  assert.match(source, /sessionRunning\?: boolean/);
  assert.match(
    source,
    /if \(!session\?\.id \|\| !sessionRunning\) return;[\s\S]*?maintainEventsConnected\(session\.id\)/,
  );
  assert.match(source, /maintainEventsConnected\(session\.id\)/);
  assert.doesNotMatch(source, /void connectEvents\(/);
  assert.match(chatWindowSource, /sessionRunning\?: boolean/);
  assert.match(chatWindowSource, /session, sessionRunning, newSessionCwd/);
  assert.match(appShellSource, /runningSessionIds\.has\(selectedSession\.id\)/);
  assert.match(appShellSource, /onRunningSessionIdsChange=\{handleRunningSessionIdsChange\}/);
});

test("keeps one reducer-owned assistant partial and consumes Pi JSON deltas", () => {
  const connectedSource = source.slice(
    source.indexOf('case "connected"'),
    source.indexOf('case "agent_start"'),
  );
  const streamSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "message_end"'),
  );
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );

  assert.match(source, /streamReducer,[\s\S]*type ClientAssistantMessageEvent/);
  assert.doesNotMatch(source, /streamingMessageRef/);
  assert.match(connectedSource, /dispatch\(\{ type: "end" \}\)/);
  assert.match(connectedSource, /event\.isStreaming === true/);
  assert.match(connectedSource, /agentRunningRef\.current = true/);
  assert.match(streamSource, /msg\?\.role === "assistant"[\s\S]*dispatch\(\{ type: "snapshot", message: msg \}\)/);
  assert.match(streamSource, /event\.assistantMessageEvent as ClientAssistantMessageEvent/);
  assert.match(streamSource, /dispatch\(\{ type: "delta", event: delta \}\)/);
  assert.match(streamSource, /delta\.type !== "toolcall_start" && delta\.type !== "toolcall_delta"/);
  assert.doesNotMatch(streamSource, /case "message_delta"/);
  assert.match(messageEndSource, /const completed = event\.message as AgentMessage/);
  assert.match(messageEndSource, /normalizeToolCalls\(completed\)/);
  assert.match(messageEndSource, /dispatch\(\{ type: "end" \}\)/);
  assert.doesNotMatch(messageEndSource, /streamState\.streamingMessage/);
});

test("plays the enabled sound once for each extension dialog", () => {
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    chatWindowSource,
    /soundedExtensionDialogIdRef\.current === extensionDialog\.id/,
  );
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  assert.match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const attentionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
    appShellSource.indexOf("  const handleAutoName = useCallback"),
  );

  assert.match(
    extensionRequestSource,
    /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/,
  );
  assert.match(chatWindowSource, /onAttentionNeeded, onSessionCreated/);
  assert.match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  assert.doesNotMatch(completionSource, /document\.visibilityState === "visible"/);
  assert.match(attentionSource, /shouldShowBrowserNotification\(\)/);
  assert.match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  assert.match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  assert.match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});


const tailFollowSource = await readFile(new URL("./useChatTailFollow.ts", import.meta.url), "utf8");


test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = source.slice(source.indexOf('case "message_start"'), source.indexOf('case "message_end"'));
  assert.match(tailFollowSource, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  assert.match(tailFollowSource, /getLiveFollowAttached\(wasAttached, previousScrollTopRef\.current, scrollTop, clientHeight, scrollHeight/);
  assert.match(tailFollowSource, /activeRef\.current \? CHAT_SCROLL_REATTACH_TOLERANCE : CHAT_SCROLL_TAIL_TOLERANCE/);
  assert.match(tailFollowSource, /else if \(!isAttached\) cancelLiveFollow\(\)/);
  assert.match(tailFollowSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(tailFollowSource, /if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  assert.match(streamUpdateSource, /if \(!pendingScrollToTailRef\.current\) scheduleLiveFollow\(\)/);
});

test("new submissions attach to the latest output instead of pinning the user message", () => {
  const scrollEffectSource = source.slice(source.indexOf('useLayoutEffect(() => {\n    if (messages.length > 0)'), source.indexOf('// Load model list'));
  assert.match(source, /pendingScrollToTailRef\.current = true/);
  assert.match(scrollEffectSource, /pendingScrollToTailRef\.current = false;[\s\S]*?followTail\(\)/);
  assert.match(tailFollowSource, /const followTail[\s\S]*?isNearBottomRef\.current = true;[\s\S]*?scrollToBottom\("auto"\)/);
  assert.doesNotMatch(source + chatWindowSource, /promptAnchorActive|scrollUserMsgToTop|promptAnchorSpacerRef/);
});

test("content and viewport resizing follow the tail without React state updates", () => {
  assert.match(source, /useChatTailFollow\(\{[\s\S]*?active: agentRunning \|\| bashRunning, ready: !loading, contentVersion: messages\.length/);
  assert.match(tailFollowSource, /new ResizeObserver\(handleResize\)/);
  assert.match(tailFollowSource, /observer\?\.observe\(content\)/);
  assert.match(tailFollowSource, /observer\?\.observe\(container\)/);
  assert.match(tailFollowSource, /if \(activeRef\.current\) scheduleLiveFollow\(\)/);
  assert.match(tailFollowSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null/);
  assert.match(tailFollowSource, /observer\?\.disconnect\(\);[\s\S]*?cancelLiveFollow\(\)/);
  assert.doesNotMatch(tailFollowSource, /useState|setPromptAnchorSpacer/);
  assert.match(chatWindowSource, /<div ref=\{messageContentRef\} style=\{\{/);
});

test("the real message tail has no artificial trailing spacer", () => {
  assert.doesNotMatch(chatWindowSource, /getPromptAnchorSpacerHeight|promptAnchorSpacer/);
  assert.match(tailFollowSource, /container\.scrollTo\(\{ top: Math\.max\(0, container\.scrollHeight - container\.clientHeight\), behavior \}\)/);
  assert.doesNotMatch(tailFollowSource, /scrollIntoView/);
  assert.match(chatWindowSource, /<div ref=\{messagesEndRef\} \/>/);
  assert.match(chatWindowSource, /<div ref=\{messageContentRef\}[^\n]*justifyContent: "flex-start"/);
});

test("new messages and completion follow only when the viewport is attached", () => {
  const scrollEffectSource = source.slice(source.indexOf('useLayoutEffect(() => {\n    if (messages.length > 0)'), source.indexOf('// Load model list'));
  assert.match(scrollEffectSource, /else if \(isNearBottomRef\.current\) \{[\s\S]*?scrollToBottom\("auto"\)/);
  assert.doesNotMatch(scrollEffectSource, /!agentRunningRef\.current/);
  assert.match(tailFollowSource, /container\.addEventListener\("scroll", handleScroll, \{ passive: true \}\)/);
});
