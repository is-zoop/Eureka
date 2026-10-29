"use client";

import { notify } from "@/lib/notification-store";
import { NotificationNotice } from "@/components/Notifications";


import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { AppNavigation } from "./AppNavigation";
import { LabelTooltip } from "./LabelTooltip";
import { BrowserPanel } from "./BrowserPanel";
import type { BrowserEvent } from "@/lib/browser-types";
import { ChatWindow } from "./ChatWindow";
import type { PlanReviewControls } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { openFileTab, saveFileViewerState } from "./file-tab-state";
import { ExtensionsCenter } from "./ExtensionsCenter";
import { OrganizationExtensionDetails, type OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { PlanReviewPanel } from "./PlanReviewPanel";
import { TurnChangesPanel } from "./TurnChangesPanel";
import type { TurnChangesRequest } from "@/lib/turn-written-files";
import type { EurekaPlanState } from "@/lib/plan-mode";
import { SettingsPage, type SettingsSection } from "./SettingsPage";
import { SessionToolPermissionsMenu, SessionToolPermissionsButton } from "./ToolPermissions";
import type { SessionToolPermissions } from "@/lib/tool-permissions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Skeleton } from "./ui/skeleton";
import { SidebarUserMenu, type SidebarUser } from "./SidebarUserMenu";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { BranchNavigator } from "./BranchNavigator";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useAudio } from "@/hooks/useAudio";
import { useDesktopTray } from "@/hooks/useDesktopTray";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import type { ChatDraftReference } from "@/lib/draft-store";
import { buildFileLineMentionText } from "@/lib/file-fuzzy";
import {
  claimExtensionAttentionNotification,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/browser-notifications";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { NAVIGATE_HISTORY_EVENT, NAVIGATION_STATE_EVENT, NavigationHistory } from "@/lib/navigation-history";
import { DESKTOP_MENU_COMMAND_EVENT, EMPTY_DESKTOP_MENU_CONTEXT, publishDesktopMenuContext, type DesktopMenuRequest } from "@/lib/desktop-menu";
import { getSessionDisplayTitle } from "@/lib/session-display-title";
import { clearLastOpen, getLastOpenSession, setLastOpenSession } from "@/lib/workspace-memory";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { BlockingExtensionUiRequest, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { FileViewerState } from "@/lib/file-viewer-state";
import type { GitDiffMode } from "@/lib/git-types";

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const TOP_BAR_ICON_BUTTON_SIZE = 36;
const LANGUAGE_MENU_WIDTH = 176;
const NAVIGATION_WIDTH = 52;

type AppHistoryLocation = {
  session: SessionInfo | null;
  cwd: string | null;
  draftId: string;
  view: "chat" | "extensions";
  settings: SettingsSection | null;
};

function appHistoryKey(location: AppHistoryLocation) {
  return JSON.stringify([location.session?.id ?? [location.cwd, location.draftId], location.view, location.settings]);
}

export function AppShell({ initialGuest = false }: { initialGuest?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { preference, toggleTheme } = useTheme();
  const themeLabelKey =
    preference === "light" ? "theme.light" : preference === "dark" ? "theme.dark" : "theme.auto";
  const { locale, setLocale, t: translate, supportedLocales } = useI18n();
  const isMobile = useIsMobile();
  useViewportHeight();
  // Audio ownership lives here (not in ChatWindow) so the completion tone can
  // also fire for tasks finishing in a non-active workspace whose ChatWindow
  // is not mounted. ChatWindow receives the audio callbacks as props.
  const { playDoneSound, unlockAudio } = useAudio();
  const notifiedAttentionRequestIdsRef = useRef(new Set<string>());
  const handleBackgroundTaskDone = useCallback(() => {
    playDoneSound();
  }, [playDoneSound]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const handleRunningSessionIdsChange = useCallback((ids: Set<string>) => {
    setRunningSessionIds((previous) => {
      if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
      return ids;
    });
  }, []);
  // The temporary id distinguishes consecutive fresh composers in one cwd.
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [newSessionDraftId, setNewSessionDraftId] = useState("initial");
  const activeNewSessionDraftKeyRef = useRef<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [mainView, setMainView] = useState<"chat" | "extensions">("chat");
  const [extensionsVisited, setExtensionsVisited] = useState(false);
  const [extensionPanelOpen, setExtensionPanelOpen] = useState(false);
  const [installedCapabilitiesRevision, setInstalledCapabilitiesRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("system");
  const [desktopRecentProjects, setDesktopRecentProjects] = useState<string[]>([]);
  const [desktopRecentSessions, setDesktopRecentSessions] = useState<SessionInfo[]>([]);
  const navigationHistoryRef = useRef(new NavigationHistory<AppHistoryLocation>(appHistoryKey));
  const restoringHistoryKeyRef = useRef<string | null>(null);
  const replaceHistoryEntryRef = useRef(false);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [hoveredResizeHandle, setHoveredResizeHandle] = useState<"sidebar" | "right" | null>(null);
  const [mobileToolbarMoreOpen, setMobileToolbarMoreOpen] = useState(false);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<SidebarUser | null>(null);
  const [authenticatedUserLoading, setAuthenticatedUserLoading] = useState(true);
  const [guest, setGuest] = useState(initialGuest);
  const [sessionContentLoading, setSessionContentLoading] = useState(false);
  const authProfileRequestedRef = useRef(false);
  useEffect(() => {
    // React Strict Mode replays effects during development. Keep this to one
    // profile refresh so Haze refresh-token rotation is never raced locally.
    if (authProfileRequestedRef.current) return;
    authProfileRequestedRef.current = true;
    void fetch("/api/marketplace-auth/session", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) as { guest?: boolean; user?: SidebarUser } | null }))
      .then(({ response, body }) => {
        if (response.status === 401) {
          window.location.replace("/login?returnTo=/");
          return;
        }
        if (response.ok && body?.user?.name) {
          setAuthenticatedUser(body.user);
          setGuest(body.guest === true);
        }
        setAuthenticatedUserLoading(false);
      })
      .catch(() => {
        window.location.replace("/login?returnTo=/");
      });
  }, []);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const extensionPanelWidthRef = useRef(360);
  const extensionPanelHandleRef = useRef<HTMLDivElement>(null);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
        navigationWidth: isMobile ? 0 : NAVIGATION_WIDTH,
      }),
    [isMobile, rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
        navigationWidth: isMobile ? 0 : NAVIGATION_WIDTH,
      }),
    [isMobile, sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const extensionPanelResizer = useResizablePanel({
    ariaLabel: "调整详情侧边栏宽度",
    cssVariable: "--right-panel-width",
    defaultWidth: 360,
    getMaxWidth: () => typeof window === "undefined" ? 720 : Math.max(300, Math.min(720, window.innerWidth - (isMobile ? 0 : NAVIGATION_WIDTH) - 32)),
    growthDirection: "left",
    maxWidth: 720,
    minWidth: 300,
    syncRefs: [extensionPanelHandleRef],
    storageKey: "pi-organization-extension-width",
    widthRef: extensionPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const mobileToolbarRef = useRef<HTMLDivElement>(null);
  const languageBtnRef = useRef<HTMLButtonElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const systemPromptLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const systemPromptLoadIdRef = useRef(0);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    setSystemPromptLoading(false);
  }, []);

  const handleSystemPromptLoaderChange = useCallback((loader: (() => Promise<void>) | null) => {
    systemPromptLoadIdRef.current += 1;
    systemPromptLoaderRef.current = loader;
    setSystemPromptLoading(false);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const [toolPermissionControls, setToolPermissionControls] = useState<SessionToolPermissions | null>(null);
  const handleToolPermissionsChange = useCallback((sessionId: string, controls: SessionToolPermissions | null) => {
    if (activeSessionIdRef.current === sessionId) setToolPermissionControls(controls);
  }, []);
  const currentToolPermissions = toolPermissionControls?.sessionId === selectedSession?.id ? toolPermissionControls : null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const handleCopySessionField = useCallback((value: string) => {
    void copyText(value).then(() => {
      notify({ type: "success", message: translate("session.copied") });
    }).catch(() => notify({ type: "error", message: translate("session.copyFailed") }));
  }, [translate]);

  useEffect(() => {
    return () => {
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "language" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((
    panel: "branches" | "system" | "language",
    keepMobileToolbarOpen = false,
  ) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
    if (isMobile && keepMobileToolbarOpen) setMobileToolbarMoreOpen(true);
  }, [isMobile]);

  const handleSystemPromptToggle = useCallback((keepMobileToolbarOpen = false) => {
    const opening = activeTopPanel !== "system";
    toggleTopPanel("system", keepMobileToolbarOpen);
    if (!opening || systemPromptLoading) return;

    const load = systemPromptLoaderRef.current;
    if (!load) return;
    const loadId = ++systemPromptLoadIdRef.current;
    setSystemPromptLoading(true);
    void load().catch((error) => {
      console.error("Failed to load system prompt:", error);
    }).finally(() => {
      if (systemPromptLoadIdRef.current === loadId) {
        setSystemPromptLoading(false);
      }
    });
  }, [activeTopPanel, systemPromptLoading, toggleTopPanel]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  const handleMobileToolbarMoreToggle = useCallback(() => {
    setSidebarOpen(false);
    setActiveTopPanel(null);
    setMobileToolbarMoreOpen((open) => !open);
  }, []);

  const [rightPanelMode, setRightPanelMode] = useState<"files" | "plan" | "changes" | "browser">("files");


  const [turnChanges, setTurnChanges] = useState<(TurnChangesRequest & { revision: number }) | null>(null);
  const [extensionDetails, setExtensionDetails] = useState<{ cwd: string; item: OrganizationExtensionDetailItem; onFavoriteChange: (id: string, isFavorite: boolean) => void } | null>(null);
  const [planReview, setPlanReview] = useState<{ plan: EurekaPlanState; controls: PlanReviewControls; readOnly: boolean } | null>(null);

  const handleRightPanelToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    if (rightPanelMode === "plan" || rightPanelMode === "changes") {
      setRightPanelMode("files");
      if (!rightPanelOpen) setRightPanelOpen(true);
      return;
    }
    setRightPanelOpen((open) => !open);
  }, [isMobile, rightPanelMode, rightPanelOpen]);

  useEffect(() => {
    if (!turnChanges || (turnChanges.sessionId === selectedSession?.id
      && turnChanges.cwd === (selectedSession?.cwd ?? newSessionCwd ?? undefined))) return;
    setTurnChanges(null);
    if (rightPanelMode === "changes") {
      setRightPanelOpen(false);
      setRightPanelMode("files");
    }
  }, [selectedSession?.id, selectedSession?.cwd, newSessionCwd, turnChanges, rightPanelMode]);

  useEffect(() => {
    if (!mobileToolbarMoreOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const toolbar = mobileToolbarRef.current;
      if (toolbar && event.composedPath().includes(toolbar)) return;
      setMobileToolbarMoreOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMobileToolbarMoreOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [mobileToolbarMoreOpen]);

  useEffect(() => {
    setMobileToolbarMoreOpen(false);
  }, [isMobile, selectedSession?.id, newSessionDraftId]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      if (activeTopPanel === "language" && !isMobile && languageBtnRef.current) {
        const buttonRect = languageBtnRef.current.getBoundingClientRect();
        const width = Math.min(LANGUAGE_MENU_WIDTH, topBarRect.width);
        const left = Math.min(
          buttonRect.left - 1,
          Math.max(topBarRect.left, topBarRect.right - width),
        );
        setTopPanelPos({ top: topBarRect.bottom, left, width });
        return;
      }
      setTopPanelPos({ top: topBarRect.bottom, left: topBarRect.left, width: topBarRect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    if (languageBtnRef.current) ro.observe(languageBtnRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel, isMobile]);

  useEffect(() => {
    if (activeTopPanel !== "branches" && activeTopPanel !== "system") return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (topBarRef.current?.contains(target) || target.closest("[data-top-panel]")) return;
      setActiveTopPanel(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [revealDirectoryPath, setRevealDirectoryPath] = useState<string | null>(null);

  const handleFileViewerStateChange = useCallback((
    tabId: string,
    viewerRevision: number,
    viewerState: FileViewerState,
  ) => {
    setFileTabs((prev) => saveFileViewerState(prev, tabId, viewerRevision, viewerState));
  }, []);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.addReferences([{ path: relativePath, isDir }]);
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    if (relativePaths.length) chatInputRef.current?.addReferences(relativePaths.map((path) => ({ path, isDir: false })));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectRootRef = useRef<string | null>(null);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Guards the async workspace restore so a slow response from an earlier
  // switch cannot resurrect a session into a project the user already left.
  const workspaceRestoreTokenRef = useRef(0);

  const invalidateWorkspaceRestore = useCallback(() => {
    workspaceRestoreTokenRef.current += 1;
  }, []);

  // Persist every active-session transition, including new and forked sessions
  // that bypass the sidebar selection handler. Transient sessions do not yet
  // carry projectRoot, so use the active project identity until hydration.
  useEffect(() => {
    if (!selectedSession) return;
    const projectKey = selectedSession.projectRoot
      ?? activeProjectRootRef.current
      ?? selectedSession.cwd;
    setLastOpenSession(projectKey, selectedSession.id);
  }, [selectedSession]);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        const draftId = `initial:${requestedCwd}`;
        setNewSessionDraftId(draftId);
        activeNewSessionDraftKeyRef.current = `new:${draftId}:${data.cwd}`;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  // Restore the workspace's last open session after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. The session
  // is looked up against the live list so a deleted or drifted session falls
  // back to the default welcome page instead of erroring.
  const restoreWorkspaceContext = useCallback((projectKey: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpenSessionId = getLastOpenSession(projectKey);
    if (!lastOpenSessionId) return;
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        if (token !== workspaceRestoreTokenRef.current) return; // stale switch
        const s = d?.sessions.find((x) => x.id === lastOpenSessionId);
        if (!s) {
          // The list loaded but the remembered session is gone — forget it.
          // When the list itself failed (d === null) keep the memory so a
          // later switch retries the restore.
          if (d) clearLastOpen(projectKey);
          return;
        }
        if ((s.projectRoot ?? s.cwd) !== projectKey) {
          // Defensive: the remembered session drifted out of this workspace.
          clearLastOpen(projectKey);
          return;
        }
        // Selecting the session must remount the chat with the session
        // present: useAgentSession loads content in a mount-only effect, so
        // the null-session welcome mount from the switch would never load
        // the restored session's messages.
        setSessionContentLoading(true);
        setSelectedSession(s);
        setSessionKey((k) => k + 1);
        if (new URLSearchParams(window.location.search).get("session") !== s.id) {
          router.replace(`?session=${encodeURIComponent(s.id)}`, { scroll: false });
        }
      })
      .catch(() => {
        // Network hiccup: keep the remembered session for a later retry.
      });
  }, [router]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    invalidateWorkspaceRestore();
    const currentFreshCwd = newSessionCwd ?? activeCwd;
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const newProject = projectRoot ?? cwd;
    const currentProject = activeProjectRootRef.current
      ?? (selectedSession ? (selectedSession.projectRoot ?? selectedSession.cwd) : null);
    activeProjectRootRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Existing sessions stay open when the worktree selector moves within the
    // same project. A fresh composer must remount when its effective cwd moves,
    // otherwise its already-created runtime would keep sending to the old cwd.
    if (
      currentProject === newProject
      && (selectedSession !== null || currentFreshCwd === cwd)
    ) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    const draftId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setNewSessionDraftId(draftId);
    activeNewSessionDraftKeyRef.current = `new:${draftId}:${cwd}`;
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    setActiveTopPanel(null);
    if (currentProject !== newProject) {
      // File tabs are keyed by absolute path, so tabs opened in the previous
      // project must not linger. Same-project worktree switches keep them.
      setFileTabs([]);
      setActiveFileTabId(null);
      setRightPanelOpen(false);
      // Restore the workspace we switched to: its last open session, or keep
      // the default welcome page when none is remembered.
      restoreWorkspaceContext(newProject);
    }
    router.replace("/", { scroll: false });
  }, [activeCwd, invalidateWorkspaceRestore, newSessionCwd, router, selectedSession, restoreWorkspaceContext]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    invalidateWorkspaceRestore();
    setMainView("chat");
    activeNewSessionDraftKeyRef.current = null;
    // Re-clicking the already-open session must not remount the chat and
    // re-run the full load/positioning cycle. Only skip when the effective
    // cwd context already matches — otherwise a pending cwd move still needs
    // the full re-select flow.
    if (!isRestore && selectedSession) {
      const sameProject =
        (selectedSession.projectRoot ?? selectedSession.cwd) ===
        (session.projectRoot ?? session.cwd);
      if (selectedSession.id === session.id && sameProject) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    setNewSessionCwd(null);
    setSessionContentLoading(true);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [invalidateWorkspaceRestore, router, isMobile, selectedSession]);

  const handleNewSession = useCallback((sessionId: string, cwd: string) => {
    invalidateWorkspaceRestore();
    setMainView("chat");
    const draftKey = `new:${sessionId}:${cwd}`;
    activeNewSessionDraftKeyRef.current = draftKey;
    setNewSessionDraftId(sessionId);
    setSessionContentLoading(false);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [invalidateWorkspaceRestore, router, isMobile]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    abortEnabled: mainView === "chat",
    onNewSession: (cwd: string) => { setSettingsOpen(false); handleNewSession(`kb-${Date.now()}`, cwd); },
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (
          prev?.id === sessionId
            ? { ...prev, ...full, transient: full.transient ?? false }
            : prev
        ));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo, sourceDraftKey: string) => {
    setRefreshKey((k) => k + 1);
    if (activeNewSessionDraftKeyRef.current !== sourceDraftKey) return;
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setNewSessionCwd(null);
    setSessionContentLoading(false);
    setSelectedSession(session);
    hydrateSelectedSession(session.id);
    replaceHistoryEntryRef.current = true;
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession]);

  const deliverSessionNotification = useCallback(({
    targetSession,
    title,
    body,
    tag,
  }: {
    targetSession: SessionInfo | null;
    title: string;
    body: string;
    tag?: string;
  }) => {
    if (!("Notification" in window)) return;

    const fire = () => {
      const sessionUrl = targetSession ? `/?session=${encodeURIComponent(targetSession.id)}` : "/";
      void showBrowserNotification({
        title,
        body,
        sessionUrl,
        tag,
        onClick: () => {
          window.focus();
          if (targetSession) handleSelectSession(targetSession);
        },
      });
    };

    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => { if (p === "granted") fire(); });
    }
  }, [handleSelectSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    if (selectedSession) hydrateSelectedSession(selectedSession.id);

    if (!shouldShowBrowserNotification()) return;
    const targetSession = selectedSession;
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.sessionComplete"),
      body: translate("i18n.taskFinished"),
    });
  }, [deliverSessionNotification, hydrateSelectedSession, selectedSession, translate]);

  const handleAttentionNeeded = useCallback((request: BlockingExtensionUiRequest) => {
    if (!shouldShowBrowserNotification()) return;
    if (!claimExtensionAttentionNotification(request, notifiedAttentionRequestIdsRef.current)) return;

    deliverSessionNotification({
      targetSession: selectedSession,
      title: translate("i18n.attentionNeeded"),
      body: request.method === "custom"
        ? translate("i18n.extensionInputNeeded")
        : request.title,
      tag: `pi-extension-ui:${request.id}`,
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      notify({ type: "success", message: "任务名称已更新。" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      notify({ type: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSessionContentLoading(true);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
      transient: false,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession]);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    navigationHistoryRef.current.remove((location) => location.session?.id === sessionId);
    invalidateWorkspaceRestore();
    setMainView("chat");
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      const draftId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      setNewSessionDraftId(draftId);
      setSessionContentLoading(false);
      activeNewSessionDraftKeyRef.current = cwd ? `new:${draftId}:${cwd}` : null;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setSystemPromptLoading(false);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [invalidateWorkspaceRestore, selectedSession, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff"; gitDiffMode?: GitDiffMode },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => openFileTab(prev, {
      fileName,
      filePath,
      modeHint,
      gitDiffMode: options?.gitDiffMode,
      sourceSessionId,
      tabId,
    }));
    setActiveFileTabId(tabId);
    setRightPanelMode("files");
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!extensionPanelOpen || mainView !== "extensions") return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || document.getElementById("extension-panel")?.contains(target) || target.closest('[data-resize-handle="extension-panel"], [data-app-navigation], #session-sidebar, [data-extension-details-portal], [role="dialog"], [role="alertdialog"]')) return;
      setExtensionPanelOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [extensionPanelOpen, mainView]);

  const handleOpenExtensionDetails = useCallback((item: OrganizationExtensionDetailItem, onFavoriteChange: (id: string, isFavorite: boolean) => void) => {
    const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd;
    if (!cwd) return;
    setExtensionDetails({ cwd, item, onFavoriteChange });
    setExtensionPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [activeCwd, isMobile, newSessionCwd, selectedSession?.cwd]);

  const handlePlanStateChange = useCallback((plan: EurekaPlanState, controls: PlanReviewControls) => {
    // Keep a manually opened historical plan visible while the latest plan
    // continues to receive progress updates in the background.
    if (plan.phase === "idle") {
      setPlanReview(null);
      setRightPanelMode((mode) => mode === "plan" ? "files" : mode);
      return;
    }
    setPlanReview((current) => {
      if (current && (current.plan.activePlanId !== plan.activePlanId || current.plan.sourceEntryId !== plan.sourceEntryId)) {
        return current;
      }
      if (current?.plan === plan && current.controls === controls && !current.readOnly) return current;
      return { plan, controls, readOnly: false };
    });
  }, []);

  const handleOpenPlanReview = useCallback((plan: EurekaPlanState, controls: PlanReviewControls, readOnly = false) => {
    setPlanReview({ plan, controls, readOnly });
    setRightPanelMode("plan");
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleExtensionFavoriteChange = useCallback((id: string, isFavorite: boolean) => {
    if (!extensionDetails) return;
    extensionDetails.onFavoriteChange(id, isFavorite);
    if (extensionDetails.item.id === id) setExtensionDetails({ ...extensionDetails, item: { ...extensionDetails.item, isFavorite } });
  }, [extensionDetails]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null });
  }, [handleOpenFile, selectedSession?.id]);

  const handleOpenTurnChanges = useCallback((request: TurnChangesRequest) => {
    setTurnChanges((previous) => ({
      ...request,
      sessionId: request.sessionId ?? selectedSession?.id,
      cwd: request.cwd ?? selectedSession?.cwd ?? newSessionCwd ?? undefined,
      revision: (previous?.revision ?? 0) + 1,
    }));
    setRightPanelMode("changes");
    setRightPanelOpen(true);
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
  }, [selectedSession?.id, selectedSession?.cwd, newSessionCwd, isMobile]);

  const handleOpenComposerReference = useCallback((reference: ChatDraftReference) => {
    if (reference.isDir) {
      setRevealDirectoryPath(reference.path);
      if (isMobile) setSidebarOpen(true);
      return;
    }
    const cwd = selectedSession?.cwd ?? newSessionCwd;
    if (!cwd) return;
    const absolute = /^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(reference.path);
    handleOpenLinkedFile(absolute ? reference.path : `${cwd.replace(/[\\/]$/, "")}/${reference.path}`);
  }, [handleOpenLinkedFile, isMobile, newSessionCwd, selectedSession?.cwd]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const newSessionDraftKey = selectedSession === null && effectiveNewSessionCwd
    ? `new:${newSessionDraftId}:${effectiveNewSessionCwd}`
    : null;
  const browserSessionId = selectedSession?.id ?? "";
  useEffect(() => {
    if (guest || !browserSessionId) return;
    let lastOpened = 0;
    const source = new EventSource(`/api/browser/events?sessionId=${encodeURIComponent(browserSessionId)}&frames=0`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as BrowserEvent;
      if (event.type !== "state") return;
      const revision = event.state.openRevision ?? 0;
      if (event.state.tabs.length && revision > lastOpened) {
        lastOpened = revision;
        setRightPanelMode("browser"); setRightPanelOpen(true);
      }
    };
    return () => source.close();
  }, [browserSessionId, guest]);
  useLayoutEffect(() => {
    activeNewSessionDraftKeyRef.current = newSessionDraftKey;
  }, [newSessionDraftKey]);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;

  // Navigation only changes visibility. In particular, keep ChatWindow's key,
  // draft owner and SSE subscription unchanged while browsing extensions.
  const handleNavigate = useCallback((view: "chat" | "extensions") => {
    if (view === "extensions" && !projectTrustCwd) return;
    if (view === "extensions") setExtensionsVisited(true);
    setActiveTopPanel(null);
    setMobileToolbarMoreOpen(false);
    setMainView(view);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, projectTrustCwd]);

  useEffect(() => {
    setExtensionDetails(null);
    setExtensionPanelOpen(false);
    if (!projectTrustCwd) setMainView("chat");
  }, [projectTrustCwd]);

  const visibleExtensionDetails = extensionDetails?.cwd === projectTrustCwd ? extensionDetails : null;
  const homeRightPanelVisible = mainView === "chat" && rightPanelOpen;
  const extensionPanelVisible = mainView === "extensions" && extensionPanelOpen && visibleExtensionDetails !== null;

  useEffect(() => {
    publishDesktopMenuContext({ ready: true, cwd: projectTrustCwd ?? activeCwd, authenticated: !guest && !authenticatedUserLoading && authenticatedUser !== null, projects: desktopRecentProjects });
  }, [projectTrustCwd, activeCwd, guest, authenticatedUserLoading, authenticatedUser, desktopRecentProjects]);

  useEffect(() => () => publishDesktopMenuContext(EMPTY_DESKTOP_MENU_CONTEXT), []);

  useDesktopTray({
    sessions: desktopRecentSessions,
    canCreate: Boolean(projectTrustCwd ?? activeCwd),
    onSelectSession: (session) => {
      setSettingsOpen(false);
      handleSelectSession(session);
    },
  });

  useEffect(() => {
    const onCommand = (event: Event) => {
      const request = (event as CustomEvent<DesktopMenuRequest>).detail;
      switch (request?.command) {
        case "new-task": {
          const cwd = projectTrustCwd ?? activeCwd;
          if (!cwd) return;
          setSettingsOpen(false);
          handleNewSession(crypto.randomUUID(), cwd);
          break;
        }
        case "settings": setSettingsSection("system"); setSettingsOpen(true); break;
        case "toggle-sidebar": setSettingsOpen(false); setSidebarOpen((open) => !open); break;
        case "toggle-files":
          setSettingsOpen(false);
          setMainView("chat");
          setRightPanelMode("files");
          setRightPanelOpen((open) => rightPanelMode !== "files" || !open);
          break;
        case "select-project":
          if (request.path && desktopRecentProjects.includes(request.path)) {
            setSettingsOpen(false);
            setMainView("chat");
          }
          break;
      }
    };
    window.addEventListener(DESKTOP_MENU_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(DESKTOP_MENU_COMMAND_EVENT, onCommand);
  }, [activeCwd, desktopRecentProjects, handleNewSession, projectTrustCwd, rightPanelMode]);

  useEffect(() => {
    // Wait for the sidebar's initial URL restore instead of recording a loading page.
    if (!showChat && !settingsOpen) return;
    if (initialSessionId && !selectedSession && newSessionDraftId === "initial") return;
    const location: AppHistoryLocation = {
      session: selectedSession,
      cwd: effectiveNewSessionCwd,
      draftId: newSessionDraftId,
      view: mainView,
      settings: settingsOpen ? settingsSection : null,
    };
    if (restoringHistoryKeyRef.current && restoringHistoryKeyRef.current !== appHistoryKey(location)) return;
    const history = navigationHistoryRef.current;
    if (restoringHistoryKeyRef.current || replaceHistoryEntryRef.current) history.replace(location);
    else history.record(location);
    restoringHistoryKeyRef.current = null;
    replaceHistoryEntryRef.current = false;
    window.dispatchEvent(new CustomEvent(NAVIGATION_STATE_EVENT, { detail: history.availability }));
  }, [selectedSession, effectiveNewSessionCwd, newSessionDraftId, mainView, settingsOpen, settingsSection, showChat, initialSessionId]);

  useEffect(() => {
    const navigate = (direction: -1 | 1) => {
      const history = navigationHistoryRef.current;
      const location = history.move(direction);
      if (!location) return false;
      restoringHistoryKeyRef.current = appHistoryKey(location);
      if (location.session && location.session.id !== selectedSession?.id) {
        handleSelectSession(location.session, true);
        router.replace(`?session=${encodeURIComponent(location.session.id)}`, { scroll: false });
      } else if (!location.session && (selectedSession || location.draftId !== newSessionDraftId || location.cwd !== effectiveNewSessionCwd)) {
        handleNewSession(location.draftId, location.cwd ?? "");
      }
      setMainView(location.view);
      if (location.view === "extensions") setExtensionsVisited(true);
      setSettingsOpen(location.settings !== null);
      if (location.settings) setSettingsSection(location.settings);
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
      window.dispatchEvent(new CustomEvent(NAVIGATION_STATE_EVENT, { detail: history.availability }));
      return true;
    };
    const onNavigate = (event: Event) => {
      const direction = (event as CustomEvent).detail;
      if (direction === -1 || direction === 1) navigate(direction);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (navigate(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
    };
    window.addEventListener(NAVIGATE_HISTORY_EVENT, onNavigate);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(NAVIGATE_HISTORY_EVENT, onNavigate);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [effectiveNewSessionCwd, handleNewSession, handleSelectSession, newSessionDraftId, router, selectedSession]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent(NAVIGATION_STATE_EVENT, { detail: { canGoBack: false, canGoForward: false } }));
  }, []);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setInstalledCapabilitiesRevision((revision) => revision + 1);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const appTitle = "Eureka";
  const windowTitle = activeCwdName && activeCwdName !== appTitle
    ? `${activeCwdName} - ${appTitle}`
    : appTitle;

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const accountMenu = (
      <SidebarUserMenu
        user={authenticatedUser}
        guest={guest}
        loading={authenticatedUserLoading}
        avatarOnly
        onOpenSettings={() => { setSettingsSection("system"); setSettingsOpen(true); }}
        onOpenModels={() => { setSettingsSection("models"); setSettingsOpen(true); }}
      />
  );

  const sidebarContent = (
    <>
      {isMobile && <AppNavigation view={mainView} onNavigate={handleNavigate} extensionsEnabled={Boolean(projectTrustCwd)} mobile />}
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onRecentProjectsChange={setDesktopRecentProjects}
        onRecentSessionsChange={setDesktopRecentSessions}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        revealDirectoryPath={revealDirectoryPath}
        onBackgroundTaskDone={handleBackgroundTaskDone}
        onRunningSessionIdsChange={handleRunningSessionIdsChange}
        onRequestHide={() => setSidebarOpen(false)}
        showExtensionsEntry={false}
      />
      {isMobile && accountMenu}
    </>
  );

  const renderThemeButton = (mobile: boolean) => (
    <button
      type="button"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        if (mobile) setMobileToolbarMoreOpen(true);
      }}
      title={translate(themeLabelKey)}
      aria-label={translate(themeLabelKey)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
        background: "none", border: "none", borderRight: "1px solid var(--border)",
        color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-muted)"; }}
      data-mobile-toolbar-action={mobile ? "theme" : undefined}
    >
      {preference === "light" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : preference === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )}
    </button>
  );

  const renderLanguageButton = (mobile: boolean) => (
    <button
      ref={languageBtnRef}
      type="button"
      onClick={() => toggleTopPanel("language", mobile)}
      title={translate("common.language")}
      aria-label={translate("common.language")}
      aria-haspopup="menu"
      aria-expanded={activeTopPanel === "language"}
      aria-pressed={activeTopPanel === "language"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
        background: activeTopPanel === "language" ? "var(--bg-selected)" : "none",
        border: "none", borderRight: "1px solid var(--border)",
        color: activeTopPanel === "language" ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = activeTopPanel === "language" ? "var(--text)" : "var(--text-muted)";
      }}
      data-mobile-toolbar-action={mobile ? "language" : undefined}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
      </svg>
    </button>
  );

  const renderProjectTrustWarning = () => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    return <NotificationNotice type="warning" message={translate("trust.resourcesNotLoaded")} eventKey={`project-trust:${projectTrustCwd}`} action={{ label: translate("trust.resourcesNotLoaded"), onClick: () => { setProjectTrustError(null); setProjectTrustDialogOpen(true); } }} />;
  };

  const renderChatToolbarActions = (mobile: boolean) => {
    if (!mobile && !showChat) return null;
    // A new task has no persisted session yet, so keep its header uncluttered.
    if (!mobile && selectedSession === null) return null;
    if (mobile && sessionContentLoading && selectedSession) {
      return <div aria-busy="true" aria-label={translate("chat.loadingSession")} style={{ display: "flex", alignItems: "center", gap: 8, height: "100%", padding: "0 10px" }}><Skeleton className="size-7 rounded-[var(--radius-control)]" /><Skeleton className="size-7 rounded-[var(--radius-control)]" /></div>;
    }
    if (!mobile) {
      const hasMessages = Boolean(
        selectedSession
        && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
      );
      const canAutoName = Boolean(selectedSession && !selectedSession.transient && hasMessages && autoNameStatus.kind !== "naming");
      const sessionTitle = getSessionDisplayTitle(selectedSession, translate("sidebar.new"));
      const titleLoading = Boolean(sessionContentLoading && selectedSession);
      const sessionCopyPath = selectedSession && !selectedSession.transient
        ? (sessionStats?.sessionId === selectedSession.id ? sessionStats.sessionFile : undefined) || selectedSession.path || null
        : null;

      return (
        <div style={{ display: "flex", alignItems: "center", minWidth: 0, height: "100%" }}>
          {titleLoading ? (
            <div aria-busy="true" aria-label={translate("chat.loadingSession")} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, height: "100%", padding: "0 14px" }}>
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-36" />
            </div>
          ) : <LabelTooltip content={sessionTitle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, height: "100%", padding: "0 14px", color: "var(--text)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /><path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" /></svg>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{sessionTitle}</span>
            </div>
          </LabelTooltip>}
          {titleLoading ? <Skeleton className="ml-1 size-7 rounded-[var(--radius-control)]" /> : <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger render={<TooltipTrigger render={<button type="button" aria-label={translate("chat.moreControls")} style={{ display: "grid", placeItems: "center", width: 34, height: 34, marginLeft: -4, padding: 0, border: "none", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }} onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; event.currentTarget.style.color = "var(--text-muted)"; }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>} />} />
              <TooltipContent>{translate("chat.moreControls")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" sideOffset={6} className="w-48 bg-[var(--bg-panel)] text-[var(--text)]">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={!selectedSession} onClick={handleViewFullHistory}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>{translate("history.label")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canAutoName} onClick={() => void handleAutoName()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L7 22l-5-5Z" /><path d="m14 5 5 5" /><path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" /></svg>{autoNameStatus.kind === "naming" ? translate("title.generating") : translate("title.generate")}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => toggleTopPanel("branches")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>{translate("i18n.branches")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSystemPromptToggle()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>{translate("system.label")}</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!selectedSession}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>{translate("i18n.copy")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuGroup>
                    <DropdownMenuItem disabled={!sessionCopyPath} onClick={() => { if (sessionCopyPath) handleCopySessionField(sessionCopyPath); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h8M8 17h5" /></svg>{translate("session.copyPath")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!selectedSession?.id} onClick={() => { if (selectedSession?.id) handleCopySessionField(selectedSession.id); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 9h16M3 15h16M10 3 8 21M16 3l-2 18" /></svg>{translate("session.copyId")}
                    </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <SessionToolPermissionsMenu key={selectedSession?.id} controls={currentToolPermissions} />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>}
          {!titleLoading && <BranchNavigator tree={branchTree} activeLeafId={branchActiveLeafId} onLeafChange={handleBranchLeafChange} inline compact containerRef={topBarRef} open={activeTopPanel === "branches"} onToggle={() => toggleTopPanel("branches")} hasSession={showChat} hideInlineButton />}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
        <button
          type="button"
          onClick={() => {
            handleViewFullHistory();
            if (mobile) setMobileToolbarMoreOpen(true);
          }}
          disabled={!selectedSession}
          title={selectedSession ? translate("history.full") : translate("history.unsaved")}
          aria-label={translate("history.full")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%",
            padding: mobile ? 0 : "0 12px",
            background: "none",
            border: "none",
            borderTop: "2px solid transparent",
            borderRight: "1px solid var(--border)",
            color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
            flexShrink: 0,
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s, opacity 0.1s",
          }}
          onMouseEnter={(event) => {
            if (!selectedSession) return;
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
            event.currentTarget.style.background = "none";
          }}
          data-mobile-toolbar-action={mobile ? "history" : undefined}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          {!mobile && <span>{translate("history.label")}</span>}
        </button>
        {(() => {
          // 上下文压缩后当前消息可能不再包含 user 消息，需同时参考会话文件的消息总数。
          const hasMessages = Boolean(
            selectedSession
            && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
          );
          const disabled = !selectedSession || selectedSession.transient || !hasMessages || autoNameStatus.kind === "naming";
          const isSuccess = autoNameStatus.kind === "success";
          const isError = autoNameStatus.kind === "error";
          const label = autoNameStatus.kind === "naming"
            ? translate("title.generating")
            : isSuccess
              ? translate("title.updated")
              : isError
                ? translate("title.failed")
                : translate("title.generate");
          const title = !selectedSession || selectedSession.transient
            ? translate("title.unsaved")
            : !hasMessages
              ? translate("title.noMessages")
              : isError
                ? autoNameStatus.message
                : translate("title.generateSession");

          return (
            <button
              type="button"
              onClick={() => {
                void handleAutoName();
                if (mobile) setMobileToolbarMoreOpen(true);
              }}
              disabled={disabled}
              title={title}
              aria-label={label}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
                height: "100%", padding: mobile ? 0 : "0 12px",
                background: "none", border: "none",
                borderTop: "2px solid transparent",
                borderRight: "1px solid var(--border)",
                color: isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
                flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
                transition: "color 0.1s, background 0.1s, opacity 0.1s",
              }}
              onMouseEnter={(event) => {
                if (disabled) return;
                event.currentTarget.style.color = isError ? "#dc2626" : "var(--text)";
                event.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)";
                event.currentTarget.style.background = "none";
              }}
              data-mobile-toolbar-action={mobile ? "name" : undefined}
            >
              {autoNameStatus.kind === "naming" ? (
                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : isSuccess ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 4 5 5L7 22l-5-5Z" />
                  <path d="m14 5 5 5" />
                  <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                </svg>
              )}
              {!mobile && <span>{label}</span>}
            </button>
          );
        })()}
        {mobile ? (
          <button
            type="button"
            onClick={() => toggleTopPanel("branches", true)}
            title={translate("i18n.branches")}
            aria-label={translate("i18n.branches")}
            aria-pressed={activeTopPanel === "branches"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: "100%", padding: 0,
              background: activeTopPanel === "branches" ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: activeTopPanel === "branches" ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              color: activeTopPanel === "branches" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0,
            }}
            data-mobile-toolbar-action="branches"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: branchTree.length > 0 ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>
        ) : (
          <BranchNavigator
            tree={branchTree}
            activeLeafId={branchActiveLeafId}
            onLeafChange={handleBranchLeafChange}
            inline
            containerRef={topBarRef}
            open={activeTopPanel === "branches"}
            onToggle={() => toggleTopPanel("branches")}
            hasSession
          />
        )}
        <button
          ref={systemBtnRef}
          type="button"
          onClick={() => handleSystemPromptToggle(mobile)}
          disabled={mobile && !showChat}
          title={translate("system.prompt")}
          aria-label={translate("system.prompt")}
          aria-pressed={activeTopPanel === "system"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%", padding: mobile ? 0 : "0 12px",
            background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: mobile && !showChat ? "not-allowed" : "pointer",
            color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
            opacity: mobile && !showChat ? 0.45 : 1,
            fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(event) => {
            if (mobile && !showChat) return;
            event.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)";
          }}
          data-mobile-toolbar-action={mobile ? "system" : undefined}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
          </svg>
          {!mobile && <span>{translate("system.label")}</span>}
        </button>
        {mobile && selectedSession && <SessionToolPermissionsButton key={selectedSession.id} controls={currentToolPermissions} />}
      </div>
    );
  };

  const renderMainFileToggle = (mobile: boolean) => {
    const covered = mobile && mobileToolbarMoreOpen;
    return (
      <button
        type="button"
        onClick={handleRightPanelToggle}
        disabled={covered}
        tabIndex={covered ? -1 : undefined}
        aria-controls="file-panel"
        aria-expanded={rightPanelOpen}
        aria-hidden={covered ? true : undefined}
        title={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        data-mobile-toolbar-file={mobile ? "true" : undefined}
        style={{
          marginLeft: mobile ? 0 : "auto",
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
          visibility: covered ? "hidden" : "visible",
          pointerEvents: covered ? "none" : "auto",
              background: "var(--chat-bg)",
              border: "none",
          color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { if (!covered) event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    );
  };

  return (
    <>
    <style>{`
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(calc(-100% - env(safe-area-inset-left)));
          box-shadow: none;
        }
      }
    `}</style>
    <div className="eureka-app-shell" style={{
      display: "flex",
      width: "100%",
      height: "var(--app-viewport-height, 100dvh)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      overflow: "hidden",
      background: "var(--sidebar-bg)",
    }}>
      {!isMobile && (
        <AppNavigation view={mainView} onNavigate={handleNavigate} extensionsEnabled={Boolean(projectTrustCwd)}>
          {accountMenu}
        </AppNavigation>
      )}
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        inert={!sidebarOpen || (!isMobile && mainView !== "chat")}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          background: "var(--sidebar-bg)",
          borderRight: `1px solid ${(hoveredResizeHandle === "sidebar" || sidebarResizer.isResizing) ? "#b8b7b7" : "var(--border)"}`,
          display: !isMobile && mainView !== "chat" ? "none" : "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {mainView === "chat" && sidebarOpen && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                {...sidebarResizer.separatorProps}
                aria-controls="session-sidebar"
                className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
                data-resize-handle="sidebar"
                onPointerEnter={() => setHoveredResizeHandle("sidebar")}
                onPointerLeave={() => setHoveredResizeHandle((current) => current === "sidebar" ? null : current)}
              />
            }
          />
          <TooltipContent side="right">{`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}</TooltipContent>
        </Tooltip>
      )}

      {/* Center: chat */}
      <div data-notification-boundary="10" className="eureka-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, background: "var(--chat-bg)" }}>
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} style={{ display: mainView === "extensions" || (!isMobile && mainView === "chat" && selectedSession === null) ? "none" : undefined, flexShrink: 0, background: "var(--chat-bg)" }}>
        <div style={{ display: "flex", alignItems: "center", position: "relative", background: "var(--chat-bg)", borderBottom: "1px solid var(--border)", height: `calc(${isMobile ? 48 : 38}px + env(safe-area-inset-top))`, paddingTop: "env(safe-area-inset-top)" }}>
          {!sidebarOpen && <button
            onClick={handleSidebarToggle}
             title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
             aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>}
          {isMobile && mainView === "chat" && (
            <div
              ref={mobileToolbarRef}
              data-mobile-toolbar="true"
              style={{
                position: "relative",
                display: "flex",
                alignItems: "stretch",
                flex: 1,
                minWidth: 0,
                height: "100%",
              }}
            >
              <button
                type="button"
                onClick={handleMobileToolbarMoreToggle}
                title={mobileToolbarMoreOpen ? translate("chat.close") : translate("chat.moreControls")}
                aria-label={mobileToolbarMoreOpen ? translate("chat.close") : translate("chat.moreControls")}
                aria-controls="mobile-toolbar-actions"
                aria-expanded={mobileToolbarMoreOpen}
                data-mobile-toolbar-more="true"
                style={{
                  position: "relative",
                  zIndex: mobileToolbarMoreOpen ? 21 : undefined,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
                  background: mobileToolbarMoreOpen ? "var(--bg-selected)" : "none",
                  border: "none", borderRight: "1px solid var(--border)",
                  color: mobileToolbarMoreOpen ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
                }}
              >
                {mobileToolbarMoreOpen ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                  </svg>
                )}
              </button>
              <div style={{ flex: 1 }} aria-hidden="true" />
              {renderMainFileToggle(true)}
              {mobileToolbarMoreOpen && (
                <div
                  id="mobile-toolbar-actions"
                  role="toolbar"
                  aria-label={translate("chat.moreControls")}
                  data-mobile-toolbar-actions="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: TOP_BAR_ICON_BUTTON_SIZE,
                    zIndex: 20,
                    display: "flex",
                    alignItems: "stretch",
                    background: "color-mix(in srgb, var(--bg-panel) 94%, var(--bg))",
                    boxShadow: "4px 0 18px rgba(0,0,0,0.12)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  {renderChatToolbarActions(true)}
                </div>
              )}
            </div>
          )}
          {!isMobile && mainView === "chat" && (
            <>
              {renderProjectTrustWarning()}
              {renderChatToolbarActions(false)}
            </>
          )}
          {!isMobile && mainView === "chat" && renderMainFileToggle(false)}
          {isMobile && mainView === "chat" && (
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              inline
              compact
              containerRef={topBarRef}
              open={activeTopPanel === "branches"}
              onToggle={() => toggleTopPanel("branches")}
              hasSession={showChat}
              hideInlineButton
            />
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div data-top-panel style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "language" && (
                <div
                  role="menu"
                  aria-label={translate("common.language")}
                  style={{
                    background: "var(--bg-panel)",
                    borderLeft: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                    overflow: "hidden",
                    padding: 4,
                  }}
                >
                  {supportedLocales.map((plugin) => (
                    <button
                      key={plugin.id}
                      type="button"
                      onClick={() => {
                        setLocale(plugin.id as typeof locale);
                        setActiveTopPanel(null);
                      }}
                      role="menuitemradio"
                      aria-checked={locale === plugin.id}
                      style={{
                        display: "flex", alignItems: "center",
                        width: "100%", height: 34, padding: "0 10px",
                        border: "none", borderRadius: 4,
                        background: locale === plugin.id ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        if (locale !== plugin.id) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (locale !== plugin.id) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span>{plugin.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {projectTrust?.requiresTrust && !projectTrust.trusted && (
                    <button type="button" onClick={() => { setProjectTrustError(null); setProjectTrustDialogOpen(true); }} className="m-3 rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]">
                      {translate("trust.dialogTitle")}
                    </button>
                  )}
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("system.empty")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {systemPromptLoading ? translate("system.loading") : translate("system.load")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
        {isMobile && renderProjectTrustWarning()}
        </div>

        {/* Keep the home workspace mounted while another page is visible. */}
        <div data-app-page="chat" inert={mainView !== "chat"} style={{ display: mainView === "chat" ? "block" : "none", flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              sessionRunning={Boolean(selectedSession && runningSessionIds.has(selectedSession.id))}
              newSessionCwd={effectiveNewSessionCwd}
              newSessionDraftKey={newSessionDraftKey}
              onAgentEnd={handleAgentEnd}
              onAttentionNeeded={handleAttentionNeeded}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSystemPromptLoaderChange={handleSystemPromptLoaderChange}
              onSessionStatsChange={handleSessionStatsChange}
              onOpenFile={handleOpenLinkedFile}
              onOpenChanges={handleOpenTurnChanges}
              onOpenComposerReference={handleOpenComposerReference}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
              onPlanStateChange={handlePlanStateChange}
              onOpenPlanReview={handleOpenPlanReview}
              onContentLoadingChange={setSessionContentLoading}
              onToolPermissionsChange={handleToolPermissionsChange}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "var(--text)" }}>{translate("workspace.opening")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <NotificationNotice title={translate("workspace.unable")} message={initialCwdError ?? initialNavigation.requestedCwd} />
          ) : null}
        </div>
        {extensionsVisited && projectTrustCwd && (
          <div data-app-page="extensions" inert={mainView !== "extensions"} style={{ display: mainView === "extensions" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <ExtensionsCenter
                key={projectTrustCwd}
                cwd={projectTrustCwd}
                guest={guest}
                active={mainView === "extensions"}
                sidebarOpen={sidebarOpen}
                installedRevision={installedCapabilitiesRevision}
                sessionId={selectedSession?.id ?? null}
                onReloaded={() => setSessionKey((key) => key + 1)}
                onTrustProject={() => { setProjectTrustError(null); setProjectTrustDialogOpen(true); }}
                onShowSidebar={!sidebarOpen ? handleSidebarToggle : undefined}
                onOpenExtensionDetails={handleOpenExtensionDetails}
                onCloseExtensionDetails={() => setExtensionPanelOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${homeRightPanelVisible ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />
      {homeRightPanelVisible && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                {...rightPanelResizer.separatorProps}
                aria-controls="file-panel"
                className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
                data-resize-handle="right-panel"
                onPointerEnter={() => setHoveredResizeHandle("right")}
                onPointerLeave={() => setHoveredResizeHandle((current) => current === "right" ? null : current)}
              />
            }
          />
          <TooltipContent side="left">{`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}</TooltipContent>
        </Tooltip>
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        inert={!homeRightPanelVisible}
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${rightPanelResizer.width}px`,
          display: mainView === "chat" ? "flex" : "none",
          flexDirection: "column",
          borderLeft: `1px solid ${(hoveredResizeHandle === "right" || rightPanelResizer.isResizing) ? "#b8b7b7" : "var(--border)"}`,
          background: "var(--chat-bg)",
        } as React.CSSProperties}
      >
        {rightPanelMode === "browser" && browserSessionId && rightPanelOpen ? (
          <BrowserPanel key={browserSessionId} sessionId={browserSessionId} onHide={() => setRightPanelOpen(false)} />
        ) : rightPanelMode === "browser" ? null : rightPanelMode === "changes" && turnChanges ? (
          <TurnChangesPanel
            key={turnChanges.revision}
            request={turnChanges}
            onClose={() => setRightPanelOpen(false)}
            onOpenFile={(filePath) => handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: turnChanges.sessionId ?? null })}
          />
        ) : rightPanelMode === "plan" && planReview ? (
          <PlanReviewPanel
            plan={planReview.plan}
            onClose={() => { setRightPanelOpen(false); }}
            onUpdate={planReview.controls.update}
            onReturnForRevision={planReview.controls.returnForRevision}
            onApprove={planReview.controls.approve}
            onAbandon={planReview.controls.abandon}
            readOnly={planReview.readOnly}
          />
        ) : <>
        {/* Right panel tab bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          height: `calc(${isMobile ? 48 : 38}px + env(safe-area-inset-top))`,
          paddingTop: "env(safe-area-inset-top)",
          background: "var(--chat-bg)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            aria-controls="file-panel"
            aria-expanded={rightPanelOpen}
            title={translate("files.hidePanel")}
            aria-label={translate("files.hidePanel")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: "var(--chat-bg)", border: "none",
              color: "var(--text)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        {/* Only the active viewer is mounted. Lightweight per-tab state is restored on activation. */}
        <div style={{ flex: 1, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {activeFileTab?.filePath ? (
            <FileViewer
              key={`${activeFileTab.id}:${activeFileTab.viewerRevision ?? 0}`}
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              gitRefreshKey={explorerRefreshKey}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              gitDiffMode={activeFileTab.gitDiffMode}
              initialState={activeFileTab.viewerState}
              watchEnabled={rightPanelOpen}
              onStateChange={(viewerState) => handleFileViewerStateChange(
                activeFileTab.id,
                activeFileTab.viewerRevision ?? 0,
                viewerState,
              )}
              onMentionLines={rightPanelOpen ? handleFileLineMention : undefined}
              onAtMention={handleAtMention}
              onOpenFile={(filePath) => handleOpenFile(
                filePath,
                getFileName(filePath),
                { sourceSessionId: activeFileTab.sourceSessionId },
              )}
            />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
               {translate("files.noneOpen")}
            </div>
          )}
        </div>
        </>}
      </div>
      {extensionPanelVisible && (
        <Tooltip>
          <TooltipTrigger render={
            <div
              ref={extensionPanelHandleRef}
              {...extensionPanelResizer.separatorProps}
              aria-controls="extension-panel"
              className={`panel-resize-handle right-panel-resize-handle organization-extension-resize-handle${extensionPanelResizer.isResizing ? " is-resizing" : ""}`}
              data-resize-handle="extension-panel"
              style={{ "--right-panel-width": `${extensionPanelResizer.width}px` } as React.CSSProperties}
            />
          } />
          <TooltipContent side="left">{translate("layout.resizeHint")}</TooltipContent>
        </Tooltip>
      )}
      <div
        ref={extensionPanelResizer.panelRef}
        id="extension-panel"
        inert={!extensionPanelVisible}
        className={`right-panel-container organization-extension-overlay${extensionPanelVisible ? " right-panel-open" : " right-panel-closed"}${extensionPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${extensionPanelResizer.width}px`,
          display: extensionPanelVisible ? "flex" : "none",
          flexDirection: "column",
          background: "var(--chat-bg)",
          borderLeft: "1px solid var(--border)",
        } as React.CSSProperties}
      >
        {visibleExtensionDetails && (
          <OrganizationExtensionDetails
            key={visibleExtensionDetails.cwd}
            sessionId={selectedSession?.id ?? null}
            item={visibleExtensionDetails.item}
            cwd={visibleExtensionDetails.cwd}
            onClose={() => setExtensionPanelOpen(false)}
            onFavoriteChange={handleExtensionFavoriteChange}
            onInstalledChange={() => setInstalledCapabilitiesRevision(value => value + 1)}
          />
        )}
      </div>
    </div>
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    {settingsOpen && (
      <div className="eureka-settings-overlay" style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--chat-bg)" }}>
        <SettingsPage initialSection={settingsSection} onBack={() => setSettingsOpen(false)} />
      </div>
    )}
    </>
  );
}
