import { randomUUID } from "node:crypto";
import { answerClarification, blockingClarification, CLARIFICATION_ENTRY, pendingClarification, readClarificationState, type ClarificationGroup, type ClarificationQueuedInput, type ClarificationState, type ClarificationTask } from "./clarification";
import type { SessionEntry } from "./types";
import type { UserInputQuestion, UserInputResponse } from "./user-input";

interface Store { getEntries(): unknown[]; getBranch?(): unknown[]; appendCustomEntry(type: string, data: unknown): unknown }
declare global { var __eurekaClarificationRuntimes: WeakMap<object, ClarificationRuntime> | undefined; }
const controllers = globalThis.__eurekaClarificationRuntimes ??= new WeakMap<object, ClarificationRuntime>();
export function clarificationRuntime(manager: object): ClarificationRuntime | undefined { return controllers.get(manager); }

/** Durable interaction state; no pending tool promise or provider connection while waiting. */
export class ClarificationRuntime {
  state: ClarificationState;
  task: ClarificationTask | null = null;
  allowed = false;
  pauseRequested = false;
  constructor(private store: Store, private changed: (state: ClarificationState) => void) {
    this.state = readClarificationState((store.getBranch?.() ?? store.getEntries()) as SessionEntry[]);
    controllers.set(store, this);
    if (this.state.groups.some((g) => g.continuation === "running")) {
      this.save({ ...this.state, groups: this.state.groups.map((g) => g.continuation === "running" ? { ...g, continuation: "failed", error: "会话运行已中断。回答已保存，请确认后重试继续。" } : g) });
    }
  }
  refresh(): void { this.state = readClarificationState((this.store.getBranch?.() ?? this.store.getEntries()) as SessionEntry[]); }
  get blocked(): boolean { return Boolean(blockingClarification(this.state)); }
  save(next: ClarificationState): void {
    this.state = { ...next, revision: this.state.revision + 1 };
    this.store.appendCustomEntry(CLARIFICATION_ENTRY, this.state);
    this.changed(this.state);
  }
  ask(toolCallId: string, questions: Omit<UserInputQuestion, "id" | "toolCallId" | "status" | "askedAt">[]): ClarificationGroup {
    if (!this.task || !this.allowed) throw new Error("当前任务未开放问题澄清工具");
    if (this.blocked) throw new Error("请等待当前问题组的回答或取消");
    const now = new Date().toISOString();
    const group: ClarificationGroup = { id: toolCallId, task: this.task, source: this.task.clarificationEnabled ? "general" : "plugin", status: "pending", continuation: "ready", createdAt: now,
      questions: questions.map((q) => ({ ...q, id: randomUUID(), toolCallId, status: "pending", askedAt: now })) };
    this.save({ ...this.state, groups: [...this.state.groups, group] });
    this.pauseRequested = true;
    return group;
  }
  group(id: unknown): ClarificationGroup {
    const group = this.state.groups.find((g) => g.id === id);
    if (!group) throw new Error("找不到此问题组，请刷新后重试");
    return group;
  }
  update(group: ClarificationGroup): void { this.save({ ...this.state, groups: this.state.groups.map((g) => g.id === group.id ? group : g) }); }
  answer(id: unknown, responses: UserInputResponse[]): ClarificationGroup {
    const current = this.group(id);
    const next = answerClarification(current, responses, new Date().toISOString());
    if (next !== current) this.update(next);
    return next;
  }
  cancel(id: unknown): void {
    const group = this.group(id);
    if (group.continuation === "completed") return;
    if (group.continuation === "running") throw new Error("请先停止当前运行，再取消澄清");
    if (group.status !== "cancelled") this.save({ ...this.state, groups: this.state.groups.map((g) => g.id === group.id ? { ...g, status: "cancelled" } : g), queue: this.state.queue.map((q) => ({ ...q, paused: true })) });
  }
  finish(id: string, error?: string): void {
    const group = this.group(id);
    if (group.continuation === "running") this.update({ ...group, continuation: error ? "failed" : "completed", error });
  }
  enqueue(input: ClarificationQueuedInput): void { this.save({ ...this.state, queue: [...this.state.queue, input] }); }
  shift(): ClarificationQueuedInput | undefined {
    if (this.blocked) return;
    const eligible = this.state.queue.filter((q) => !q.paused);
    const selected = eligible.find((q) => q.behavior === "steer") ?? eligible[0];
    if (!selected) return;
    this.save({ ...this.state, queue: this.state.queue.filter((q) => q !== selected) });
    return selected;
  }
  get pending(): ClarificationGroup | undefined { return pendingClarification(this.state); }
  dispose(): void { controllers.delete(this.store); }
}
