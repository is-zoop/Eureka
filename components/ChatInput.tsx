"use client";

import { NotificationNotice } from "@/components/Notifications";


import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  dedupeReferences,
  type ChatDraftImage,
  type ChatDraftReference,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { ToolPreset } from "@/lib/tool-presets";
import type { EurekaPlanState } from "@/lib/plan-mode";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[], references?: ChatDraftReference[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[], references?: ChatDraftReference[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[], references?: ChatDraftReference[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[], references?: ChatDraftReference[]) => void;
  isStreaming: boolean;
  inputLocked?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  planMode?: EurekaPlanState;
  onPlanModeChange?: (planning: boolean) => void;
  onOpenPlanReview?: () => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  onOpenReference?: (reference: ChatDraftReference) => void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  addReferences: (references: ChatDraftReference[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: ChatDraftImage[], references?: ChatDraftReference[], targetDraftKey?: string) => void;
}

const TOOL_PRESETS = ["off", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  off: "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8;

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
};

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin" },
  { name: "copy", description: "chat.commandCopy", source: "builtin" },
];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const COMMAND_PALETTE_SOURCES = ["builtin", "extension", "skill"] as const;
type CommandPaletteSource = typeof COMMAND_PALETTE_SOURCES[number];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = COMMAND_PALETTE_SOURCES
    .map((source) => {
      // Prompt commands are presented with built-ins for now. Their original
      // source remains intact, so we can expose a dedicated group later.
      const sourceCommands = source === "builtin"
        ? commands.filter((command) => command.source === "builtin" || command.source === "prompt")
        : commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

function CommandPaletteIcon({ kind }: { kind: "add" | "plan" | CommandPaletteSource }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (kind === "add") {
    return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /><path d="M17 4v4M15 6h4" /></svg>;
  }
  if (kind === "plan") {
    return <svg {...common}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>;
  }
  if (kind === "extension") {
    return <svg {...common}><path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z" /><path d="M17 21v-2" /><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10" /><path d="M21 21v-2" /><path d="M3 5V3" /><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z" /><path d="M7 5V3" /></svg>;
  }
  if (kind === "skill") {
    return <svg {...common}><path d="M12 5v16" /><path d="M16 13h2" /><path d="M16 9h2" /><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z" /><path d="M6 13h2" /><path d="M6 9h2" /></svg>;
  }
  return <svg {...common}><path d="M10 22v-8" /><path d="M2.336 8.89 10 14l11.715-7.029" /><path d="M22 14a2 2 0 0 1-.971 1.715l-10 6a2 2 0 0 1-2.138-.05l-6-4A2 2 0 0 1 2 16v-6a2 2 0 0 1 .971-1.715l10-6a2 2 0 0 1 2.138.05l6 4A2 2 0 0 1 22 8z" /></svg>;
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: 12,
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: 999,
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body }: { tone: "error" | "warning"; title: string; body: string }) {
  return <NotificationNotice type={tone} title={title} message={body} eventKey={`model-notice:${tone}:${body}`} />;
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title="Model error" body={error} />;
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={warnings.length > 1 ? "Model scope warnings" : "Model scope warning"}
      body={warnings.join("\n")}
    />
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, inputLocked = false, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  planMode, onPlanModeChange, onOpenPlanReview,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  onOpenReference,
}: Props, ref) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { isDark } = useTheme();
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [pendingStreamingSubmission, setPendingStreamingSubmission] = useState<{ message: string; images: AttachedImage[]; references: ChatDraftReference[] } | null>(null);
  const [deferredModel, setDeferredModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [deferredThinkingLevel, setDeferredThinkingLevel] = useState<Props["thinkingLevel"] | null>(null);
  const [deferredToolPreset, setDeferredToolPreset] = useState<ToolPreset | null>(null);
  const [compactBlockedNotice, setCompactBlockedNotice] = useState(false);
  const [planModeGlowReady, setPlanModeGlowReady] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const [references, setReferences] = useState<ChatDraftReference[]>(() => draftKey ? getDraft(draftKey)?.references ?? [] : []);
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuQuery, setAddMenuQuery] = useState("");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  useEffect(() => {
    if (isStreaming) return;
    if (deferredModel && onModelChange) {
      const next = deferredModel;
      setDeferredModel(null);
      onModelChange(next.provider, next.modelId);
    }
    if (deferredThinkingLevel && onThinkingLevelChange) {
      const next = deferredThinkingLevel;
      setDeferredThinkingLevel(null);
      onThinkingLevelChange(next);
    }
    if (deferredToolPreset && onToolPresetChange) {
      const next = deferredToolPreset;
      setDeferredToolPreset(null);
      onToolPresetChange(next);
    }
    setCompactBlockedNotice(false);
  }, [isStreaming, deferredModel, deferredThinkingLevel, deferredToolPreset, onModelChange, onThinkingLevelChange, onToolPresetChange]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const addMenuAnchorRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const atItemRefs = useRef<Array<HTMLElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const referencesRef = useRef(references);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;
  referencesRef.current = references;

  const resizeTextarea = useCallback((target = textareaRef.current) => {
    if (!target) return;
    const maxHeight = 200;
    const minHeight = isMobile ? 52 : 82;
    target.style.height = "auto";
    const nextHeight = Math.max(minHeight, Math.min(target.scrollHeight, maxHeight));
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [isMobile]);

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        references: referencesRef.current,
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [], references: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      setReferences(moved.references ?? []);
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(text: string, images?: ChatDraftImage[], restoredReferences?: ChatDraftReference[], targetDraftKey?: string) {
      if (!text.trim() && !images?.length && !restoredReferences?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
        restoredReferences,
        targetsCurrentComposer ? referencesRef.current : (storedDraft?.references ?? []),
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      referencesRef.current = restoredDraft.references ?? [];
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setReferences(restoredDraft.references ?? []);
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addReferences(nextReferences: ChatDraftReference[]) {
      const next = dedupeReferences([...referencesRef.current, ...nextReferences]);
      referencesRef.current = next;
      setReferences(next);
      setAtQuery(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result is "data:<mime>;base64,<data>"
                const base64 = result.split(",")[1];
                resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    referencesRef.current = [];
    setReferences([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
      references,
    });
  }, [attachedImages, draftKey, references, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        references: referencesRef.current,
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    const nextReferences = draft?.references ?? [];
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    referencesRef.current = nextReferences;
    setValue(nextValue);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
    setReferences(nextReferences);
  }, [draftKey]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length && !references.length) return;
    if (isStreaming || inputLocked) return;
    onAudioUnlock?.();
    if (!attachedImages.length && !references.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined, references);
  }, [value, attachedImages, references, isStreaming, inputLocked, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const commandPaletteOpen = addMenuOpen || (slashMenuOpen && slashQuery !== null);
  const allSlashCommands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
  const filterSlashCommands = (query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...allSlashCommands]
      .filter((command) => {
        if (!normalizedQuery) return true;
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(normalizedQuery) || description.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const rankDelta = normalizedQuery
          ? slashMatchRank(a, normalizedQuery, t) - slashMatchRank(b, normalizedQuery, t)
          : 0;
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  };

  const filteredSlashCommands = slashQuery === null ? [] : filterSlashCommands(slashQuery);
  const filteredAddMenuCommands = filterSlashCommands(addMenuQuery);

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy);
  const { groups: groupedAddMenuCommands } = buildSlashCommandLayout(filteredAddMenuCommands, skillDormancy);
  const addImageMatches = !addMenuQuery.trim() || [
    t("chat.addImage"),
    t("chat.addImageDescription"),
  ].join(" ").toLowerCase().includes(addMenuQuery.trim().toLowerCase());
  const planModeMatches = Boolean(onPlanModeChange) && !planMode?.planModeActive && (!addMenuQuery.trim() || "计划模式 开启计划模式 规划".includes(addMenuQuery.trim().toLowerCase()));
  const addMenuHasResults = addImageMatches || planModeMatches || filteredAddMenuCommands.length > 0;
  const commandDescriptionColor = "var(--text-muted)";
  const commandPaletteBackground = isDark ? "var(--bg-panel)" : "#ffffff";
  const commandPaletteRadius = 8;

  const hasInputText = Boolean(value.trim());
  const referenceNameCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const reference of references) {
      const name = reference.path.replace(/\\/g, "/").split("/").at(-1) ?? reference.path;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [references]);
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0 || references.length > 0;
  const composerDrawerVisible = Boolean(pendingStreamingSubmission);
  const planModeActive = Boolean(planMode?.planModeActive);

  useEffect(() => {
    if (!planModeActive) {
      setPlanModeGlowReady(false);
      return;
    }
    const animationFrame = requestAnimationFrame(() => setPlanModeGlowReady(true));
    return () => cancelAnimationFrame(animationFrame);
  }, [planModeActive]);

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const newValue = before + after;
    const newPos = before.length;
    const nextReferences = dedupeReferences([...referencesRef.current, { path: entry.path, isDir: entry.isDir }]);
    referencesRef.current = nextReferences;
    setReferences(nextReferences);
    setValue(newValue);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setAddMenuOpen(false);
    setAddMenuQuery("");
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup", pending?: { message: string; images: AttachedImage[]; references: ChatDraftReference[] }) => {
    const msg = pending?.message ?? value.trim();
    const images = pending?.images ?? attachedImages;
    const queuedReferences = pending?.references ?? references;
    if (!msg && !images.length && !queuedReferences.length) return;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (!queuedReferences.length && msg.startsWith("/") && onPromptWithStreamingBehavior) {
      if (!pending) clearInput();
      onPromptWithStreamingBehavior(msg, streamingBehavior, images.length ? images : undefined, queuedReferences);
      return;
    }
    if (!pending) clearInput();
    if (mode === "steer" && onSteer) {
      onSteer(msg, images.length ? images : undefined, queuedReferences);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, images.length ? images : undefined, queuedReferences);
    }
  }, [value, attachedImages, references, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  const stageStreamingSubmission = useCallback(() => {
    const message = value.trim();
    if (!message && !attachedImages.length && !references.length) return;

    setPendingStreamingSubmission({ message, images: attachedImages, references });
    valueRef.current = "";
    attachedImagesRef.current = [];
    referencesRef.current = [];
    setValue("");
    setAttachedImages(() => []);
    setReferences([]);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
  }, [value, attachedImages, references, draftKey]);

  const restoreStagedStreamingSubmission = useCallback(() => {
    if (!pendingStreamingSubmission) return;
    valueRef.current = pendingStreamingSubmission.message;
    attachedImagesRef.current = pendingStreamingSubmission.images;
    referencesRef.current = pendingStreamingSubmission.references;
    setValue(pendingStreamingSubmission.message);
    setAttachedImages(() => pendingStreamingSubmission.images);
    setReferences(pendingStreamingSubmission.references);
    setPendingStreamingSubmission(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [pendingStreamingSubmission]);

  const confirmStagedStreamingSubmission = useCallback((mode: "steer" | "followup") => {
    if (!pendingStreamingSubmission) return;
    const pending = pendingStreamingSubmission;
    setPendingStreamingSubmission(null);
    sendQueued(mode, pending);
  }, [pendingStreamingSubmission, sendQueued]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const itemNodes = Array.from(
      slashMenuRef.current?.querySelectorAll<HTMLElement>("[data-slash-index]") ?? [],
    );
    const currentNode = itemNodes.find((node) => Number(node.dataset.slashIndex) === slashActiveIndex);
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = itemNodes.find((item) => Number(item.dataset.slashIndex) === index);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && displayedSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(displayedSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          stageStreamingSubmission();
        } else {
          handleSend();
        }
      }
    },
    [isMobile, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, stageStreamingSubmission, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      slashCommandsRequestedRef.current = false;
      return;
    }
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [commandPaletteOpen, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!commandPaletteOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [commandPaletteOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashMenuRef.current
      ?.querySelector<HTMLElement>(`[data-slash-index="${slashActiveIndex}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }

    const menu = slashMenuRef.current;
    if (!menu) return;

    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const nextHeight = getUpwardMenuMaxHeight(
        menu.getBoundingClientRect().bottom,
        getVisibleTopBoundary(menu),
      );
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    };
    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    update();
    const anchorObserver = typeof ResizeObserver === "undefined" || !menu.parentElement
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (menu.parentElement) anchorObserver?.observe(menu.parentElement);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      anchorObserver?.disconnect();
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [slashMenuOpen, slashQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  })();
  const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of filteredModelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const effectiveModel = deferredModel ?? model;
  const effectiveThinkingLevel = deferredThinkingLevel ?? thinkingLevel;
  const effectiveToolPreset = deferredToolPreset ?? toolPreset;
  const displayModelName = effectiveModel
    ? (modelOptions.find((o) => o.modelId === effectiveModel.modelId && o.provider === effectiveModel.provider)?.name ?? effectiveModel.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
    : null;
  const capitalizeDisplayLabel = (label: string) => label ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
  const thinkingDisplayLabel = capitalizeDisplayLabel((() => {
    const lvl = effectiveThinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })());
  const toolPresetLabel = capitalizeDisplayLabel(Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (effectiveToolPreset ?? "default"))?.[0] ?? "default");

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
        setModelFilter("");
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
      if (
        addMenuAnchorRef.current && !addMenuAnchorRef.current.contains(e.target as Node) &&
        addMenuRef.current && !addMenuRef.current.contains(e.target as Node)
      ) {
        setAddMenuOpen(false);
        setAddMenuQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!addMenuOpen) return;
    const frameId = requestAnimationFrame(() => {
      addMenuRef.current?.querySelector<HTMLInputElement>("[data-slot='command-input']")?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);



  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: isMobile ? "0 16px 8px" : "0 16px 30px",
        paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            padding: "5px 0",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                   title={t("chat.recallTitle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                   {t("chat.recall")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
             {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}<NotificationNotice type="warning" message={retryInfo.errorMessage} title={t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })} />
          </div>
        )}
        <NotificationNotice type="success" message={compactResultText} />
        {compactBlockedNotice && <NotificationNotice type="warning" message={t("chat.compactWhileRunning")} />}
        {compactError && (
          <NotificationNotice message={compactError} type="error" />
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {addMenuOpen && (
            <div
              ref={addMenuRef}
              role="dialog"
              aria-label={t("chat.addCommandMenu")}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 140,
                height: isMobile ? 280 : 320,
                border: "1px solid var(--border)",
                borderRadius: commandPaletteRadius,
                background: commandPaletteBackground,
                boxShadow: "var(--shadow-overlay)",
                overflow: "hidden",
              }}
            >
              <Command shouldFilter={false} className="rounded-none bg-transparent text-[color:var(--text)]">
                <CommandInput
                  value={addMenuQuery}
                  onValueChange={setAddMenuQuery}
                  placeholder={t("chat.searchAddCommands")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setAddMenuOpen(false);
                      setAddMenuQuery("");
                    }
                  }}
                />
                <CommandList className="max-h-none flex-1 px-1.5 pb-1.5" style={{ maxHeight: isMobile ? 224 : 264 }}>
                  {!addMenuHasResults && <CommandEmpty>{t("chat.noMatchingCommands")}</CommandEmpty>}
                  {(addImageMatches || planModeMatches) && (
                    <CommandGroup heading={t("chat.add")}>
                      {addImageMatches && <CommandItem
                        value="add-image"
                        title={`${t("chat.addImage")} · ${t("chat.addImageDescription")}`}
                        onSelect={() => {
                          setAddMenuOpen(false);
                          setAddMenuQuery("");
                          fileInputRef.current?.click();
                        }}
                        className="cursor-pointer py-1.5 text-[color:var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center text-[color:var(--text-muted)]"><CommandPaletteIcon kind="add" /></span>
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-[13px] font-medium">{t("chat.addImage")}</span>
                          <span className="truncate text-[11px]" style={{ color: commandDescriptionColor }}>{t("chat.addImageDescription")}</span>
                        </span>
                      </CommandItem>}
                      {planModeMatches && <CommandItem value="plan-mode" title="计划模式 · 开启只读规划与评审流程" onSelect={() => {
                        setAddMenuOpen(false); setAddMenuQuery(""); onPlanModeChange?.(true);
                      }} className="cursor-pointer py-1.5 text-[color:var(--text)] data-[selected=true]:bg-[var(--bg-hover)]">
                        <span className="flex size-5 shrink-0 items-center justify-center text-[color:var(--text-muted)]"><CommandPaletteIcon kind="plan" /></span>
                        <span className="flex min-w-0 items-baseline gap-2"><span className="shrink-0 text-[13px] font-medium">计划模式</span><span className="truncate text-[11px]" style={{ color: commandDescriptionColor }}>开启只读规划与评审流程</span></span>
                      </CommandItem>}
                    </CommandGroup>
                  )}
                  {slashCommandsLoading && (
                    <div className="px-3 py-2 text-[11px] text-[color:var(--text-dim)]">{t("chat.loadingCommands")}</div>
                  )}
                  {groupedAddMenuCommands.map((group) => (
                    <CommandGroup key={group.source} heading={t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}>
                      {group.items.map(({ command }) => {
                        const dormant = isDormantSkillCommand(command, skillDormancy);
                        const description = getSlashDescription(command, t);
                        return (
                          <CommandItem
                            key={`${command.source}:${command.name}`}
                            value={`${command.source}:${command.name}`}
                            title={description ? `/${command.name} · ${description}` : `/${command.name}`}
                            onSelect={() => applySlashCommand(command)}
                            className="cursor-pointer py-1.5 text-[color:var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
                          >
                            <span className="flex size-5 shrink-0 items-center justify-center text-[color:var(--text-muted)]"><CommandPaletteIcon kind={group.source} /></span>
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="shrink-0 text-[13px] font-medium">/{command.name}{dormant ? <span className="ml-1 text-[10px] font-normal text-[color:var(--text-dim)]">{t("chat.dormant")}</span> : null}</span>
                              {description && <span className="truncate text-[11px]" style={{ color: commandDescriptionColor }}>{description}</span>}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </div>
          )}
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                maxHeight: "min(44vh, 360px)",
              }}
            >
              <div
                title="Input history"
                style={{
                  height: 30,
                  padding: "0 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-dim)",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <div style={{ maxHeight: "calc(min(44vh, 360px) - 31px)", overflowY: "auto", padding: 4 }}>
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "7px 8px",
                        border: "none",
                        borderRadius: 6,
                        background: active ? "var(--bg-selected)" : "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 12.5,
                        lineHeight: 1.45,
                      }}
                    >
                      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", paddingTop: 1 }}>
                        {index + 1}
                      </span>
                      <span style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                        {item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && !addMenuOpen && (
            <div
              ref={slashMenuRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 140,
                height: isMobile ? 280 : 320,
                background: commandPaletteBackground,
                border: "1px solid var(--border)",
                borderRadius: commandPaletteRadius,
                boxShadow: "var(--shadow-overlay)",
                overflow: "hidden",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Command shouldFilter={false} className="rounded-none bg-transparent text-[color:var(--text)]">
                <CommandList className="max-h-none flex-1 px-1.5 py-1.5" style={{ maxHeight: isMobile ? 280 : 320 }}>
                  {!slashCommandsLoading && filteredSlashCommands.length === 0 && <CommandEmpty>{t("chat.noCommands")}</CommandEmpty>}
                  {groupedSlashCommands.map((group) => (
                    <CommandGroup key={group.source} heading={t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}>
                      {group.items.map(({ command, index }) => {
                        const active = index === slashActiveIndex;
                        const dormant = isDormantSkillCommand(command, skillDormancy);
                        const description = getSlashDescription(command, t);
                        return (
                          <CommandItem
                            key={`${command.source}:${command.name}`}
                            data-slash-index={index}
                            value={`${command.source}:${command.name}`}
                            title={description ? `/${command.name} · ${description}` : `/${command.name}`}
                            onSelect={() => applySlashCommand(command)}
                            onMouseEnter={() => setSlashActiveIndex(index)}
                            className="cursor-pointer py-1.5 text-[color:var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
                            style={{ background: active ? "var(--bg-hover)" : undefined }}
                          >
                            <span className="flex size-5 shrink-0 items-center justify-center text-[color:var(--text-muted)]"><CommandPaletteIcon kind={group.source} /></span>
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="shrink-0 text-[13px] font-medium">/{command.name}{dormant ? <span className="ml-1 text-[10px] font-normal text-[color:var(--text-dim)]">{t("chat.dormant")}</span> : null}</span>
                              {description && <span className="truncate text-[11px]" style={{ color: commandDescriptionColor }}>{description}</span>}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  background: commandPaletteBackground,
                  border: "1px solid var(--border)",
                  borderRadius: commandPaletteRadius,
                  boxShadow: "var(--shadow-overlay)",
                  overflow: "hidden",
                  maxHeight: "min(48vh, 400px)",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Command shouldFilter={false} className="rounded-none bg-transparent text-[color:var(--text)]">
                  <CommandList className="max-h-none flex-1 px-1.5 py-1.5" style={{ maxHeight: "min(48vh, 400px)" }}>
                    <CommandGroup heading={indexLoading ? t("chat.loadingFiles") : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}>
                      {!indexLoading && atMatches.length === 0 ? (
                        <CommandEmpty>{needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}</CommandEmpty>
                      ) : (
                        atMatches.map((entry, index) => {
                          const active = index === atActiveIndex;
                          const name = entry.path.split("/").pop() ?? entry.path;
                          const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                          return (
                            <CommandItem
                              key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                              ref={(node) => {
                                atItemRefs.current[index] = node;
                              }}
                              value={entry.path}
                              onSelect={() => applyAtCompletion(entry)}
                              onMouseEnter={() => setAtActiveIndex(index)}
                              className="cursor-pointer py-1.5 text-[color:var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
                              style={{ background: active ? "var(--bg-hover)" : undefined }}
                            >
                              <span className="flex size-5 shrink-0 items-center justify-center">
                                {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                              </span>
                              <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                                <span className="shrink-0 text-[13px]">{name}{entry.isDir && "/"}</span>
                                {dirPrefix && <span className="truncate text-[11px] text-[color:var(--text-muted)]">{dirPrefix}</span>}
                              </span>
                            </CommandItem>
                          );
                        })
                      )}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            );
          })()}
          {composerDrawerVisible && (
            <div
              aria-label="输入框状态抽屉"
              style={{
                position: "absolute",
                left: isMobile ? 8 : 18,
                right: isMobile ? 8 : 18,
                bottom: "calc(100% - 16px)",
                zIndex: 0,
                background: "var(--input-bg)",
                border: `1px solid ${bashMode ? "var(--tool-bg)" : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
                borderRadius: 16,
                boxShadow: "var(--shadow-soft)",
                overflow: "hidden",
                paddingBottom: 16,
              }}
            >
              {pendingStreamingSubmission && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: isMobile ? "wrap" : "nowrap",
                  gap: 8,
                  minHeight: 48,
                  padding: "8px 12px 8px 14px",
                }}>
                  <div style={{ minWidth: isMobile ? "100%" : 0, flex: 1 }}>
                    <div style={{ marginBottom: 2, color: "var(--text-dim)", fontSize: 10, fontWeight: 600, letterSpacing: "0.4px" }}>{t("chat.pendingSend")}</div>
                    <div style={{ overflow: "hidden", color: "var(--text)", fontSize: 13, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pendingStreamingSubmission.message || t("chat.attachedImageCount", { count: pendingStreamingSubmission.images.length })}
                    </div>
                  </div>
                  <button type="button" onClick={restoreStagedStreamingSubmission} style={{ flexShrink: 0, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 7, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
                    {t("chat.moveToInput")}
                  </button>
                  {onFollowUp && <button type="button" onClick={() => confirmStagedStreamingSubmission("followup")} style={{ flexShrink: 0, padding: "5px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-hover)", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 550 }}>
                    {t("chat.queueSend")}
                  </button>}
                  {onSteer && <button type="button" onClick={() => confirmStagedStreamingSubmission("steer")} style={{ flexShrink: 0, padding: "5px 9px", border: "1px solid transparent", borderRadius: 7, background: isDark ? "#ffffff" : "#080707", color: isDark ? "#080707" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    {t("chat.immediateSteer")}
                  </button>}
                </div>
              )}
            </div>
          )}
          <div
            className={planModeActive ? `plan-mode-composer${planModeGlowReady ? " plan-mode-composer-active" : ""}` : undefined}
            style={{
              position: "relative",
              // The bottom control bar deliberately overlaps the lower part of
              // the composer.  Keeping this container as a stacking context
              // made that otherwise transparent bar sit above the absolute
              // send button, so mouse clicks never reached it.  Only raise the
              // composer as a whole while the streaming drawer is present;
              // otherwise the send button's own z-index can sit above the bar.
              zIndex: composerDrawerVisible ? 1 : "auto",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
              background: "var(--input-bg)",
              border: `1px solid ${planModeActive && planModeGlowReady ? "color-mix(in srgb, #3b82f6 18%, var(--border))" : bashMode ? "var(--tool-bg)" : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
              borderRadius: 16,
              padding: "10px 10px 10px 14px",
              boxShadow: planModeActive && planModeGlowReady
                ? "0 7px 20px rgba(59, 130, 246, 0.12), 0 0 0 1px rgba(59, 130, 246, 0.1)"
                : "var(--shadow-soft)",
              transition: planModeActive
                ? "border-color 860ms cubic-bezier(0.16, 1, 0.3, 1), background var(--transition-ui), box-shadow 860ms cubic-bezier(0.16, 1, 0.3, 1)"
                : "border-color var(--transition-ui), background var(--transition-ui), box-shadow var(--transition-ui)",
            } as React.CSSProperties}
          >
          {references.length > 0 && (
            <div aria-label={t("chat.referencedFiles")} style={{ display: "flex", flexWrap: "wrap", gap: 6, width: "100%" }}>
              {references.map((reference) => {
                const segments = reference.path.replace(/\\/g, "/").split("/");
                const baseName = segments.at(-1) ?? reference.path;
                const name = `${referenceNameCounts.get(baseName)! > 1 ? reference.path : baseName}${reference.isDir ? "/" : ""}`;
                return (
                  <div key={`${reference.isDir ? "dir" : "file"}:${reference.path}`} title={reference.path} style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%", height: 26, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)", color: "var(--text-muted)", overflow: "hidden" }}>
                    <button type="button" onClick={() => onOpenReference?.(reference)} aria-label={t("chat.openReference", { path: reference.path })} style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, height: "100%", border: 0, background: "transparent", color: "inherit", padding: "0 6px 0 8px", cursor: "pointer" }}>
                      <span style={{ display: "inline-flex", flexShrink: 0 }}>{reference.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{name}</span>
                    </button>
                    <button type="button" onClick={() => setReferences((current) => { const next = current.filter((item) => item.path !== reference.path || item.isDir !== reference.isDir); referencesRef.current = next; return next; })} aria-label={t("chat.removeReference", { path: reference.path })} title={t("chat.removeReference", { path: reference.path })} style={{ width: 24, height: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: 0, borderLeft: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m2 2 6 6M8 2 2 8" /></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            disabled={inputLocked}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              setHistoryMenuOpen(false);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              inputLocked ? "请先回答当前规划澄清问题"
                : isStreaming && (onSteer || onFollowUp)
                ? t("chat.steerPlaceholder")
                : isStreaming ? t("chat.agentPlaceholder")
                : t("chat.messagePlaceholder")
            }
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              opacity: inputLocked ? 0.55 : 1,
              fontSize: 15,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: isMobile ? 52 : 82,
              maxHeight: 200,
              overflowY: "hidden",
              boxSizing: "border-box",
              paddingRight: isStreaming && canQueueStreamingMessage ? 260 : 112,
              paddingBottom: isMobile ? 0 : 40,
            }}
          />

          {isStreaming && canQueueStreamingMessage ? (
            <div style={{ position: "absolute", right: 24, bottom: 10, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Tooltip>
              <TooltipTrigger render={<button
                  onClick={stageStreamingSubmission}
                  aria-label={t("chat.send")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 14px", height: 32,
                    background: isDark ? "#ffffff" : "#080707",
                    border: "1px solid transparent",
                    borderRadius: 16,
                    color: isDark ? "#080707" : "#fff",
                    cursor: "pointer",
                    fontSize: 14, fontWeight: 550, letterSpacing: "-0.01em",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                    transition: "background var(--transition-ui), box-shadow var(--transition-ui)",
                  }}
                  onMouseEnter={(event) => { event.currentTarget.style.opacity = "0.86"; }}
                  onMouseLeave={(event) => { event.currentTarget.style.opacity = "1"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  {t("chat.send")}
                </button>} />
                <TooltipContent>{t("chat.send")}</TooltipContent>
                </Tooltip>
            </div>
          ) : isStreaming ? (
            <Tooltip>
            <TooltipTrigger render={<button
              onClick={onAbort}
              aria-label={t("chat.stopAgent")}
              style={{
                position: "absolute", right: 24, bottom: 10,
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", height: 32,
                background: isDark ? "#ffffff" : "#080707",
                border: "none", borderRadius: 16,
                color: isDark ? "#080707" : "#fff",
                cursor: "pointer", fontSize: 14, fontWeight: 550,
                letterSpacing: "-0.01em", boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>
              {t("chat.stop")}
            </button>} />
            <TooltipContent>{t("chat.stopAgent")}</TooltipContent>
            </Tooltip>
          ) : !isStreaming && (
            <button
              type="button"
              onClick={handleSend}
              disabled={inputLocked || (!value.trim() && !attachedImages.length && !references.length)}
              style={{
                position: "absolute",
                zIndex: 3,
                right: 24,
                bottom: 10,
                pointerEvents: "auto",
                flexShrink: 0,
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", height: 32,
                background: (value.trim() || attachedImages.length || references.length) ? (isDark ? "#ffffff" : "#080707") : "var(--bg-panel)",
                border: "none",
                borderRadius: 16,
                color: (value.trim() || attachedImages.length || references.length) ? (isDark ? "#080707" : "#fff") : "var(--text-dim)",
                cursor: (value.trim() || attachedImages.length || references.length) ? "pointer" : "not-allowed",
                fontSize: 14,
                fontWeight: 550,
                letterSpacing: "-0.01em",
                boxShadow: (value.trim() || attachedImages.length || references.length) ? "0 4px 12px rgba(0,0,0,0.25)" : "none",
                transition: "background var(--transition-ui), box-shadow var(--transition-ui)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                <path d="m21.854 2.147-10.94 10.939" />
              </svg>
              {t("chat.send")}
            </button>
          )}
          </div>
        </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* Bottom bar: left | center (context) | right */}
        <div style={{
          // Keep this bar in normal flow. It used to overlap the textarea via
          // a negative margin, which let multi-line content sit under controls.
          marginTop: 8,
          padding: isMobile ? undefined : "0 112px 0 6px",
          position: "relative",
          zIndex: 1,
          // Keep the model and reasoning selectors in one continuous row.  The
          // former mobile grid stretched the model column to the available
          // width, which visually detached "Auto" from the selected model.
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: "0 0 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 2 }}>
            <div ref={addMenuAnchorRef} style={{ flexShrink: 0 }}>
              <Tooltip>
              <TooltipTrigger render={<button
                type="button"
                onClick={() => {
                  setSlashMenuOpen(false);
                  setAddMenuOpen((open) => {
                    if (open) setAddMenuQuery("");
                    return !open;
                  });
                }}
                aria-label={t("chat.openAddMenu")}
                aria-expanded={addMenuOpen}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: addMenuOpen ? "var(--bg-hover)" : "none", border: "none",
                  borderRadius: 9,
                  color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = addMenuOpen ? "var(--bg-hover)" : "none";
                  e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>} />
              <TooltipContent>{t("chat.openAddMenu")}</TooltipContent>
              </Tooltip>

            </div>
            {/* Model selector — visible always, disabled while the session or switch is busy */}
            {(modelOptions.length > 0 || currentName || modelError) && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative", flex: "0 0 auto", minWidth: 0 }}>
                  <Tooltip>
                  <TooltipTrigger render={<button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((open) => {
                        if (open) setModelFilter("");
                        return !open;
                      });
                    }}
                    disabled={modelSwitching}
                    aria-busy={modelSwitching || undefined}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 4px 8px 12px",
                      height: 32,
                      maxWidth: 220,
                      overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      cursor: modelSwitching ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: modelSwitching ? 0.5 : 1,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (modelSwitching) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-hover)" : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    {modelSwitching ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                      </svg>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {currentName ?? (modelOptions.length > 0 ? "Select model" : "No models")}
                    </span>
                  </button>} />
                  <TooltipContent>{modelSwitching ? "Switching model" : modelOptions.length > 0 ? "Change model" : "No available models"}</TooltipContent>
                  </Tooltip>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const menuHeight = Math.max(160, Math.min(360, modelDropdownRect.top - 8, viewportHeight - 16));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                      : { left: modelDropdownRect.left, width: 260 };
                    return (
                      <div ref={modelDropdownPanelRef} style={{
                      position: "fixed",
                      bottom,
                      ...panelPos,
                      zIndex: 500,
                      height: menuHeight,
                      overflow: "hidden",
                      }}>
                      <Command shouldFilter={false} style={{
                        height: "100%",
                        background: "var(--bg-panel)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-card)",
                        boxShadow: "var(--shadow-soft)",
                      }}>
                        <CommandInput
                            value={modelFilter}
                            onValueChange={setModelFilter}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === "Escape") {
                                setModelFilter("");
                                setModelDropdownOpen(false);
                              }
                            }}
                            placeholder={t("chat.filterModels")}
                            aria-label={t("chat.filterModels")}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            style={{
                              minWidth: isMobile ? 0 : 220,
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                              color: "var(--text)",
                            }}
                        />
                      <CommandList style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
                        {modelsByProvider.length === 0 ? (
                          <CommandEmpty style={{ display: "block", color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {modelFilter.trim() ? t("chat.noMatchingModels") : "No available models"}
                          </CommandEmpty>
                        ) : modelsByProvider.map((group) => (
                          <CommandGroup key={group.provider} heading={modelsByProvider.length > 1 ? group.provider.toUpperCase() : undefined}>
                            {group.options.map((opt) => {
                              const isActive = opt.modelId === effectiveModel?.modelId && opt.provider === effectiveModel?.provider;
                              return (
                                <CommandItem
                                  key={`${opt.provider}:${opt.modelId}`}
                                  value={`${opt.name} ${opt.modelId} ${opt.provider}`}
                                  onSelect={() => {
                                    setModelDropdownOpen(false);
                                    setModelFilter("");
                                    if (!isActive || isAutoModelSelection) {
                                      if (isStreaming) setDeferredModel({ provider: opt.provider, modelId: opt.modelId });
                                      else onModelChange(opt.provider, opt.modelId);
                                    }
                                  }}
                                  style={{
                                    minHeight: 32,
                                    padding: "6px 24px 6px 8px",
                                    background: isActive ? "var(--bg-selected)" : "transparent",
                                    color: isActive ? "var(--text)" : "var(--text-muted)",
                                    cursor: "pointer", fontSize: 12,
                                    fontWeight: isActive ? 600 : 400,
                                  }}
                                  onMouseEnter={(event) => { if (!isActive) event.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(event) => { if (!isActive) event.currentTarget.style.background = "transparent"; }}
                                >
                                  {isActive
                                    ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                                    : <span style={{ width: 10, flexShrink: 0 }} />}
                                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.name}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        ))}
                      </CommandList>
                      </Command>
                    </div>
                    );
                  })()}
                </div>
            )}
          </div>

          {/* Reasoning and tool controls follow the model selector on desktop. */}
          <div ref={controlsMenuRef} style={{
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            marginLeft: 0,
          }}>
            {isMobile && (
              <button
                type="button"
                 title={controlsMenuOpen ? undefined : t("chat.moreControls")}
                 aria-label={t("chat.moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setModelDropdownOpen(false);
                  setModelFilter("");
                  setControlsMenuOpen(true);
                }}
                style={{
                  display: "none",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: 32,
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: "var(--text-muted)",
                  cursor: controlsMenuOpen ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  visibility: controlsMenuOpen ? "hidden" : "visible",
                  pointerEvents: controlsMenuOpen ? "none" : "auto",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {t("chat.moreControls")}
              </button>
            )}
            <div style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 2,
            }}>
            {onThinkingLevelChange && (
              <DropdownMenu open={thinkingDropdownOpen} onOpenChange={setThinkingDropdownOpen}>
                <Tooltip>
                <DropdownMenuTrigger
                  render={
                <TooltipTrigger render={<button
                  type="button"
                  disabled={false}
                   aria-label={t("chat.changeReasoningLabel")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "8px 12px 8px 2px",
                    width: isMobile ? "auto" : undefined,
                    height: 32,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m 17.2986 11.6413 c -0.6036 4.7 -4.5831 5.4245 -8.7144 4.7904" />
                    <path d="m 3.6667 20.3333 S 5.416 4.972 20.3333 3.6667 c -0.7467 1.3013 -0.764 3.4733 -1.2613 5.652 -0.6987 2.6813 -3.1133 3.0147 -6.072 3.0147" />
                  </svg>
                  <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>
                </button>} />
                  }
                />
                <TooltipContent>{t("chat.changeReasoning", { level: thinkingDisplayLabel })}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align={isMobile ? "start" : "end"}
                  side="top"
                  sideOffset={6}
                  style={{
                    minWidth: 180,
                    padding: 4,
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel style={{ color: "var(--text-dim)", fontSize: 13 }}>
                      {t("chat.changeReasoningLabel")}
                    </DropdownMenuLabel>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (effectiveThinkingLevel ?? "auto") === lvl;
                       const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = capitalizeDisplayLabel((mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl);
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <DropdownMenuCheckboxItem
                          key={lvl}
                          checked={isActive}
                          onCheckedChange={(checked) => {
                            if (checked && !isActive) {
                              if (isStreaming) setDeferredThinkingLevel(lvl);
                              else onThinkingLevelChange(lvl);
                            }
                            setThinkingDropdownOpen(false);
                          }}
                          style={{
                            gap: 8,
                            alignItems: "flex-start",
                            minHeight: 42,
                            padding: "6px 28px 6px 8px",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer", fontSize: 13,
                            fontWeight: isActive ? 600 : 400,
                          }}
                          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                            <span style={{ color: "var(--text)", lineHeight: 1.2 }}>
                              {displayLabel}
                              {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                            </span>
                            <span style={{ color: commandDescriptionColor, fontSize: 11, fontWeight: 400, lineHeight: 1.2, whiteSpace: "normal" }}>{desc}</span>
                          </span>
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {planMode?.planModeActive && (
              <>
              <span aria-hidden="true" style={{ width: 1, height: 16, margin: "0 4px", background: "var(--border)", flexShrink: 0 }} />
              <Tooltip>
                <TooltipTrigger render={<button
                  type="button"
                  onClick={() => onPlanModeChange?.(false)}
                  disabled={isStreaming || planMode.phase === "reviewing"}
                  aria-label="退出计划模式"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    height: 28,
                    marginLeft: 2,
                    padding: "0 7px",
                    border: "none",
                    borderRadius: 7,
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: isStreaming || planMode.phase === "reviewing" ? "default" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming || planMode.phase === "reviewing" ? 0.55 : 1,
                  }}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center"><CommandPaletteIcon kind="plan" /></span>
                  <span style={{ whiteSpace: "nowrap" }}>计划模式</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
                </button>} />
                <TooltipContent>退出计划模式</TooltipContent>
              </Tooltip>
              </>
            )}
            {/* Reserve the middle space so the tool preset remains right-aligned. */}
            <div style={{ flex: 1 }} />
            {onToolPresetChange && !planMode?.planModeActive && (
              <DropdownMenu open={toolDropdownOpen} onOpenChange={setToolDropdownOpen}>
                <Tooltip>
                <DropdownMenuTrigger
                  render={
                <TooltipTrigger render={<button
                  type="button"
                  disabled={false}
                   aria-label={t("chat.changeToolPreset")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: "8px 12px",
                    width: undefined,
                    height: 32,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="4" />
                    <g display="none">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 8.25C9.92893 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92893 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" fill="currentColor" />
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C11.2954 1.25 10.6519 1.44359 9.94858 1.77037C9.26808 2.08656 8.48039 2.55304 7.49457 3.13685L6.74148 3.58283C5.75533 4.16682 4.96771 4.63324 4.36076 5.07944C3.73315 5.54083 3.25177 6.01311 2.90334 6.63212C2.55548 7.25014 2.39841 7.91095 2.32306 8.69506C2.24999 9.45539 2.24999 10.3865 2.25 11.556V12.444C2.24999 13.6135 2.24999 14.5446 2.32306 15.3049C2.39841 16.0891 2.55548 16.7499 2.90334 17.3679C3.25177 17.9869 3.73315 18.4592 4.36076 18.9206C4.96771 19.3668 5.75533 19.8332 6.74148 20.4172L7.4946 20.8632C8.48038 21.447 9.2681 21.9135 9.94858 22.2296C10.6519 22.5564 11.2954 22.75 12 22.75C12.7046 22.75 13.3481 22.5564 14.0514 22.2296C14.7319 21.9134 15.5196 21.447 16.5054 20.8632L17.2585 20.4172C18.2446 19.8332 19.0323 19.3668 19.6392 18.9206C20.2669 18.4592 20.7482 17.9869 21.0967 17.3679C21.4445 16.7499 21.6016 16.0891 21.6769 15.3049C21.75 14.5446 21.75 13.6135 21.75 12.4441V11.556C21.75 10.3866 21.75 9.45538 21.6769 8.69506C21.6016 7.91095 21.4445 7.25014 21.0967 6.63212C20.7482 6.01311 20.2669 5.54083 19.6392 5.07944C19.0323 4.63324 18.2447 4.16683 17.2585 3.58285L16.5054 3.13685C15.5196 2.55303 14.7319 2.08656 14.0514 1.77037C13.3481 1.44359 12.7046 1.25 12 1.25ZM8.22524 4.44744C9.25238 3.83917 9.97606 3.41161 10.5807 3.13069C11.1702 2.85676 11.5907 2.75 12 2.75C12.4093 2.75 12.8298 2.85676 13.4193 3.13069C14.0239 3.41161 14.7476 3.83917 15.7748 4.44744L16.4609 4.85379C17.4879 5.46197 18.2109 5.89115 18.7508 6.288C19.2767 6.67467 19.581 6.99746 19.7895 7.36788C19.9986 7.73929 20.1199 8.1739 20.1838 8.83855C20.2492 9.51884 20.25 10.378 20.25 11.5937V12.4063C20.25 13.622 20.2492 14.4812 20.1838 15.1614C20.1199 15.8261 19.9986 16.2607 19.7895 16.6321C19.581 17.0025 19.2767 17.3253 18.7508 17.712C18.2109 18.1089 17.4879 18.538 16.4609 19.1462L15.7748 19.5526C14.7476 20.1608 14.0239 20.5884 13.4193 20.8693C12.8298 21.1432 12.4093 21.25 12 21.25C11.5907 21.25 11.1702 21.1432 10.5807 20.8693C9.97606 20.5884 9.25238 20.1608 8.22524 19.5526L7.53909 19.1462C6.5121 18.538 5.78906 18.1089 5.24923 17.712C4.72326 17.3253 4.419 17.0025 4.2105 16.6321C4.00145 16.2607 3.88005 15.8261 3.81618 15.1614C3.7508 14.4812 3.75 13.622 3.75 12.4063V11.5937C3.75 10.378 3.7508 9.51884 3.81618 8.83855C3.88005 8.1739 4.00145 7.73929 4.2105 7.36788C4.419 6.99746 4.72326 6.67467 5.24923 6.288C5.78906 5.89115 6.5121 5.46197 7.53909 4.85379L8.22524 4.44744Z" fill="currentColor" />
                    </g>
                  </svg>
                  <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>
                </button>} />
                  }
                />
                <TooltipContent>{t("chat.changeToolPreset") + `: ${toolPresetLabel}`}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align={isMobile ? "start" : "end"}
                  side="top"
                  sideOffset={6}
                  style={{
                    minWidth: 180,
                    padding: 4,
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel style={{ color: "var(--text-dim)", fontSize: 13 }}>
                      {t("chat.changeToolPreset")}
                    </DropdownMenuLabel>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (effectiveToolPreset ?? "default") === preset;
                      let desc: string;
                      if (lvl === "off") desc = t("chat.noTools");
                      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                      else desc = t("chat.allBuiltInTools");
                      return (
                        <DropdownMenuCheckboxItem
                          key={lvl}
                          checked={isActive}
                          onCheckedChange={(checked) => {
                            if (checked && !isActive) {
                              if (isStreaming) setDeferredToolPreset(preset);
                              else onToolPresetChange(preset);
                            }
                            setToolDropdownOpen(false);
                          }}
                          style={{
                            gap: 8,
                            alignItems: "flex-start",
                            minHeight: 42,
                            padding: "6px 28px 6px 8px",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer", fontSize: 13,
                            fontWeight: isActive ? 600 : 400,
                          }}
                          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                            <span style={{ color: "var(--text)", lineHeight: 1.2 }}>{capitalizeDisplayLabel(lvl)}</span>
                            <span style={{ color: commandDescriptionColor, fontSize: 11, fontWeight: 400, lineHeight: 1.2, whiteSpace: "normal" }}>{desc}</span>
                          </span>
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {onCompact && (
              <div style={{ marginLeft: 6 }}>
                <Tooltip>
                <TooltipTrigger render={<button
                  onClick={isStreaming && !isCompacting ? () => setCompactBlockedNotice(true) : isCompacting ? onAbortCompaction : onCompact}
                  disabled={false}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 0,
                    width: 32,
                    height: 32,
                    background: isCompacting ? "rgba(239,68,68,0.08)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: isCompacting ? "#ef4444" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12, opacity: 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.08)" : "none";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text-muted)";
                  }}
                   aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                >
                  {isCompacting ? (
                    <svg width="14" height="14" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>
                  ) : (
                    <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.0" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8" />
                      <path d="M9 19.8V15m0 0H4.2M9 15l-6 6" />
                      <path d="M15 4.2V9m0 0h4.8M15 9l6-6" />
                      <path d="M9 4.2V9m0 0H4.2M9 9 3 3" />
                    </svg>
                    </>
                  )}
                </button>} />
                <TooltipContent>{isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}</TooltipContent>
                </Tooltip>
              </div>
            )}


            {false && onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                 title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                 aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  width: isMobile ? 32 : 32,
                  height: 32,
                  padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                    <path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742" />
                    <path d="m2 2 20 20" />
                    <path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05" />
                  </svg>
                )}
              </button>
            )}
            {isMobile && controlsMenuOpen && (
              <button
                type="button"
                 title={t("chat.collapseControls")}
                 aria-label={t("chat.collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setToolDropdownOpen(false);
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 32,
                  padding: 0,
                  marginLeft: 0,
                  background: "var(--bg-hover)",
                  border: "none",
                  borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                  borderRadius: "0 9px 9px 0",
                  color: "var(--text)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
});
