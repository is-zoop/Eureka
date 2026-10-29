import type { StreamAction } from "./streaming-message";

type SingleAction = Exclude<StreamAction, { type: "batch" }>;

/** Batch only high-frequency deltas; lifecycle and completion stay immediate. */
export class StreamUpdateBuffer {
  private pending: SingleAction[] = [];
  private cancel: (() => void) | null = null;

  constructor(
    private readonly emit: (action: StreamAction) => void,
    private readonly schedule: (flush: () => void) => () => void,
  ) {}

  send = (action: SingleAction): void => {
    if (action.type === "delta" && (action.event.type === "text_delta" || action.event.type === "thinking_delta")) {
      this.pending.push(action);
      this.cancel ??= this.schedule(this.flush);
      return;
    }
    if (action.type === "start" || action.type === "end" || action.type === "snapshot") this.clear();
    else this.flush();
    this.emit(action);
  };

  flush = (): void => {
    const actions = this.pending;
    this.clear();
    if (actions.length) this.emit({ type: "batch", actions });
  };

  clear = (): void => {
    this.cancel?.();
    this.cancel = null;
    this.pending = [];
  };
}
