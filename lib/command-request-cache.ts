/** A small per-composer cache; failures remain retryable and never erase a list. */
export class CommandRequestCache<T> {
  private entries = new Map<string, { value?: T; expiresAt: number; pending?: Promise<T> }>();
  private generation = 0;
  private ttlMs: number;
  constructor(ttlMs = 30_000) { this.ttlMs = ttlMs; }

  peek(key: string): T | undefined { return this.entries.get(key)?.value; }
  isFresh(key: string): boolean { return (this.entries.get(key)?.expiresAt ?? 0) > Date.now(); }
  invalidate() { this.generation++; this.entries.clear(); }

  load(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    const existing = this.entries.get(key);
    if (!force && existing?.value !== undefined && this.isFresh(key)) return Promise.resolve(existing.value);
    if (!force && existing?.pending) return existing.pending;
    const generation = this.generation;
    const entry = { value: existing?.value, expiresAt: existing?.expiresAt ?? 0, pending: undefined as Promise<T> | undefined };
    this.entries.set(key, entry);
    entry.pending = Promise.resolve().then(loader).then((value) => {
      if (generation === this.generation && this.entries.get(key) === entry) { entry.value = value; entry.expiresAt = Date.now() + this.ttlMs; }
      return value;
    }).finally(() => { entry.pending = undefined; });
    return entry.pending;
  }
}
