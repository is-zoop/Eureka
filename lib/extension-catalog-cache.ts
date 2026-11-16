interface Entry { expiresAt: number; value?: unknown; bytes?: number; pending?: Promise<unknown> }

/** Read-only presentation data. Never cache installation or execution authority. */
export class ExtensionCatalogCache {
  private entries = new Map<string, Entry>();
  constructor(private limit = 32, private now = Date.now, private maxBytes = 8 * 1024 * 1024) {}

  async read<T>(key: string, ttl: number, load: () => Promise<T>, force = false): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.pending) return structuredClone(await existing.pending) as T;
    if (!force && existing && existing.expiresAt > this.now()) return structuredClone(existing.value) as T;
    for (const [name, entry] of this.entries) if (!entry.pending && entry.expiresAt <= this.now()) this.entries.delete(name);
    while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    const entry: Entry = { expiresAt: 0 };
    this.entries.set(key, entry);
    const pending = Promise.resolve().then(load);
    entry.pending = pending;
    try {
      const value = await pending;
      if (this.entries.get(key) === entry) {
        const bytes = Buffer.byteLength(JSON.stringify(value) ?? "");
        if (ttl <= 0 || bytes > this.maxBytes / 2) this.entries.delete(key);
        else {
          while ([...this.entries.values()].reduce((sum, item) => sum + (item.bytes ?? 0), 0) + bytes > this.maxBytes) this.entries.delete(this.entries.keys().next().value!);
          if (this.entries.get(key) === entry) { entry.value = value; entry.bytes = bytes; entry.expiresAt = this.now() + ttl; entry.pending = undefined; }
        }
      }
      return structuredClone(value);
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  invalidate(prefix: string) { for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key); }
}

declare global { var __eurekaExtensionCatalogCache: ExtensionCatalogCache | undefined; }
export const extensionCatalogCache = globalThis.__eurekaExtensionCatalogCache ??= new ExtensionCatalogCache();
