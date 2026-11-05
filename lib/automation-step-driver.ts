import { randomUUID } from "node:crypto";

export interface AppPendingStep { token: string; nodeId: string; execution: number; inputRef: string }

/** Holds actual script closures in their worker, never reconstructs or replays
 * a step from a UI node. Receipts make repeated advance calls idempotent. */
export class AutomationStepDriver {
  private queue = new Map<string, { step: AppPendingStep; resolve: () => void; reject: (error: Error) => void }>();
  private issued = new Set<string>();
  private current?: AppPendingStep;
  private closed = false;
  constructor(private changed: (pending: AppPendingStep[], current?: AppPendingStep) => Promise<void>) {}
  private publish() { return this.changed([...this.queue.values()].map(item => item.step), this.current); }
  async wait(nodeId: string, execution: number, inputRef: string) {
    if (this.closed) throw new Error("步骤调度已停止。");
    const step = { token: randomUUID(), nodeId, execution, inputRef };
    const gate = new Promise<void>((resolve, reject) => { this.queue.set(step.token, { step, resolve, reject }); });
    void gate.catch(() => {});
    try { await this.publish(); await gate; }
    catch (error) { this.queue.delete(step.token); throw error; }
  }
  async advance(token: string) {
    if (this.closed) throw new Error("步骤调度已停止。");
    if (this.issued.has(token)) return;
    const next = this.queue.values().next().value;
    if (!next || next.step.token !== token) throw new Error("步骤引用已变化，请读取当前运行状态。");
    if (this.current) throw new Error("上一步尚未结束，请等待原步骤，不要重复调度。");
    this.queue.delete(token); this.current = next.step; this.issued.add(token);
    try { await this.publish(); next.resolve(); }
    catch (error) { next.reject(error instanceof Error ? error : new Error(String(error))); throw error; }
  }
  async complete(execution: number) {
    if (this.current?.execution !== execution) return;
    this.current = undefined; await this.publish();
  }
  close(reason: string) {
    this.closed = true;
    for (const item of this.queue.values()) item.reject(new Error(reason));
    this.queue.clear(); this.current = undefined;
  }
}
