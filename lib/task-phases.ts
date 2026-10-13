import { getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "./message-display";
import { isEditToolName, isWriteToolName } from "./tool-names";
import type { AssistantContentBlock, AssistantMessage, ToolResultMessage } from "./types";

export type TaskTurnStatus = "running" | "completed" | "failed" | "stopped" | "incomplete";
export interface TaskPhaseSource {
  message: AssistantMessage;
  messageIndex: number;
  entryId?: string;
  completedAt?: number;
  isStreaming?: boolean;
}
export interface TaskBlockReference {
  source: TaskPhaseSource;
  block: AssistantContentBlock;
  blockIndex: number;
}
export interface TaskPhase {
  id: string;
  summary: TaskBlockReference[];
  items: TaskBlockReference[];
  status: TaskTurnStatus;
  fallbackKey: string;
  toolCallCount: number;
  thinkingCount: number;
}
export interface TaskTurnView {
  phases: TaskPhase[];
  status: TaskTurnStatus;
  answerSource?: TaskPhaseSource;
  answerBlockIndices: number[];
}

function matchesCommittedMessage(stream: AssistantMessage, saved: AssistantMessage): boolean {
  if (stream === saved) return true;
  const streamed = stream.content ?? [];
  const committed = saved.content ?? [];
  if (streamed.length !== committed.length) return false;
  return streamed.every((block, index) => {
    const other = committed[index];
    if (block === other) return true;
    if (block.type === "text" && other.type === "text") return block.text === other.text;
    if (block.type === "thinking" && other.type === "thinking") return block.thinking === other.thinking && block.deferred === other.deferred;
    return block.type === "toolCall" && other.type === "toolCall" && block.toolCallId === other.toolCallId;
  });
}

function references(source: TaskPhaseSource): TaskBlockReference[] {
  const displayable = new Set(getDisplayableAssistantBlocks(source.message, { isStreaming: source.isStreaming }));
  return (source.message.content ?? []).flatMap((block, blockIndex) => displayable.has(block) ? [{ source, block, blockIndex }] : []);
}

function fallbackKey(items: TaskBlockReference[], runningToolIds?: ReadonlySet<string>): string {
  const tools = items.filter((item) => item.block.type === "toolCall");
  const active = tools.find((item) => item.block.type === "toolCall" && runningToolIds?.has(item.block.toolCallId)) ?? tools.at(-1);
  if (!active || active.block.type !== "toolCall") return "taskPhase.analyzing";
  const name = active.block.toolName.toLowerCase();
  if (name === "read") return "taskPhase.reading";
  if (isEditToolName(name) || isWriteToolName(name)) return "taskPhase.editing";
  if (name === "bash" || name === "bash (local)") return "taskPhase.command";
  if (["grep", "find", "ls"].includes(name)) return "taskPhase.searching";
  return "taskPhase.tools";
}

/** Rebuild presentation only; every reference retains its original file block index. */
export function buildTaskPhases(input: TaskPhaseSource[], options: {
  running: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  runningToolIds?: ReadonlySet<string>;
  summaryExcludedMessageIndices?: ReadonlySet<number>;
}): TaskTurnView {
  const sources = input.filter((source, index) => !(source.isStreaming && index > 0
    && matchesCommittedMessage(source.message, input[index - 1].message)));
  const visible = sources.filter((source) => references(source).length > 0 || source.message.stopReason === "error" || source.message.stopReason === "aborted");
  const last = visible.at(-1);
  // Keep trailing reply text after its execution records, including while it
  // streams. If another tool arrives, rebuilding reclassifies the text as a
  // progress description. Logical run completion still comes from events.
  const answerBlocks = last
    ? splitFinalAssistantBlocks(last.message, { isStreaming: last.isStreaming }).answerBlocks : [];
  const answerRefs = last ? references(last).filter((ref) => answerBlocks.includes(ref.block)) : [];
  const hasAnswer = answerRefs.some(({ block }) => block.type === "image" || (block.type === "text" && block.text.trim()));
  const status: TaskTurnStatus = options.running ? "running"
    : last?.message.stopReason === "error" ? "failed"
    : last?.message.stopReason === "aborted" ? "stopped"
    : hasAnswer ? "completed" : "incomplete";
  const phases: TaskPhase[] = [];
  let current: TaskPhase | undefined;
  const ensurePhase = () => {
    if (!current) {
      current = { id: "phase-" + phases.length, summary: [], items: [], status: "running",
        fallbackKey: "taskPhase.analyzing", toolCallCount: 0, thinkingCount: 0 };
      phases.push(current);
    }
    return current;
  };
  for (const source of visible) {
    for (const ref of references(source)) {
      if (answerRefs.some((answer) => answer.source === source && answer.blockIndex === ref.blockIndex)) continue;
      if (ref.block.type === "text" || ref.block.type === "image") {
        if (ref.block.type === "text" && !ref.block.text.trim()) continue;
        if (options.summaryExcludedMessageIndices?.has(source.messageIndex)) continue;
        if (current && (current.toolCallCount > 0 || current.items.some((item) => item.source !== source))) {
          // Thinking before a new visible update belongs to that new stage,
          // even when the model emitted it before the update in the same entry.
          const pendingThinking: TaskBlockReference[] = [];
          while (current.items.at(-1)?.source === source && current.items.at(-1)?.block.type === "thinking") {
            pendingThinking.unshift(current.items.pop()!);
            current.thinkingCount--;
          }
          current = undefined;
          const next = ensurePhase();
          next.items.push(...pendingThinking);
          next.thinkingCount += pendingThinking.length;
        }
        ensurePhase().summary.push(ref);
      } else {
        const phase = ensurePhase();
        phase.items.push(ref);
        if (ref.block.type === "toolCall") phase.toolCallCount++;
        if (ref.block.type === "thinking") phase.thinkingCount++;
      }
    }
  }
  if (options.running && phases.length === 0 && !hasAnswer) ensurePhase();
  phases.forEach((phase, index) => {
    const calls = phase.items.filter((ref) => ref.block.type === "toolCall");
    const active = options.running && calls.some((ref) => ref.block.type === "toolCall" && options.runningToolIds?.has(ref.block.toolCallId) && !options.toolResults?.has(ref.block.toolCallId));
    const missing = calls.some((ref) => ref.block.type === "toolCall" && !options.toolResults?.has(ref.block.toolCallId));
    phase.fallbackKey = fallbackKey(phase.items, options.runningToolIds);
    phase.status = active || (options.running && (missing || (index === phases.length - 1 && !hasAnswer))) ? "running"
      : index === phases.length - 1 && status !== "completed" && status !== "running" ? status
      : missing ? "incomplete" : "completed";
  });
  return { phases, status, answerSource: hasAnswer || last?.message.stopReason === "error" ? last : undefined,
    answerBlockIndices: answerRefs.map((ref) => ref.blockIndex) };
}
