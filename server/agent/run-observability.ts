/** Bounded, process-local observations. Never retain provider payloads or credentials. */
export class RunObservability {
  tools: Record<string, { updates: number; text: string; at: number }> = {};
  requests: { startedAt: number; firstEventMs?: number; durationMs?: number; status: string; retries: number }[] = [];
  observe(event: { type: string; [key: string]: unknown }, now = Date.now()) {
    if (event.type === "agent_start") { this.tools = {}; this.requests = []; }
    if (event.type === "tool_execution_update" && typeof event.toolCallId === "string") {
      const id = event.toolCallId;
      if (["__proto__", "constructor", "prototype"].includes(id)) return;
      if (!this.tools[id] && Object.keys(this.tools).length >= 64) return;
      const previous = this.tools[id];
      // Only numeric progress metadata is exposed. Arbitrary text and structured
      // results are intentionally excluded from this additional browser channel.
      const result = event.partialResult as { progress?: unknown; total?: unknown } | undefined;
      const progress = result?.progress, total = result?.total;
      const text = typeof progress === "number" && Number.isFinite(progress) && progress >= 0
        ? `${progress}${typeof total === "number" && Number.isFinite(total) && total >= progress ? ` / ${total}` : ""}` : "";
      this.tools[id] = { updates: (previous?.updates ?? 0) + 1, text, at: now };
    }
    if (event.type === "tool_execution_end") delete this.tools[String(event.toolCallId)];
    if (event.type === "request_start") {
      if (this.requests.length >= 64) this.requests.shift();
      this.requests.push({ startedAt: now, status: "running", retries: 0 });
    }
    const request = this.requests.at(-1);
    if (request && event.type === "message_update" && request.firstEventMs === undefined) request.firstEventMs = now - request.startedAt;
    if (request && event.type === "message_end" && (event.message as { role?: string })?.role === "assistant") {
      request.durationMs = now - request.startedAt;
      request.status = String((event.message as { stopReason?: string }).stopReason ?? "completed");
    }
    if (request && event.type === "auto_retry_start") request.retries++;
    if (["agent_end", "prompt_done"].includes(event.type)) {
      this.tools = {};
      if (request?.status === "running") { request.status = "settled"; request.durationMs = now - request.startedAt; }
    }
  }
}
