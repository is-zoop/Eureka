export const NAVIGATE_HISTORY_EVENT = "eureka:navigate-history";
export const NAVIGATION_STATE_EVENT = "eureka:navigation-state";

export type NavigationAvailability = { canGoBack: boolean; canGoForward: boolean };

/** In-app history: transient pages do not need to become browser URLs. */
export class NavigationHistory<T> {
  private entries: T[] = [];
  private index = -1;
  private key: (entry: T) => string;

  constructor(key: (entry: T) => string) {
    this.key = key;
  }

  record(entry: T) {
    const current = this.entries[this.index];
    if (current && this.key(current) === this.key(entry)) {
      this.replace(entry);
      return;
    }
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    this.index = this.entries.length - 1;
  }

  replace(entry: T) {
    if (this.index < 0) this.record(entry);
    else this.entries[this.index] = entry;
  }

  move(direction: -1 | 1): T | null {
    const next = this.index + direction;
    if (next < 0 || next >= this.entries.length) return null;
    this.index = next;
    return this.entries[next];
  }

  remove(predicate: (entry: T) => boolean) {
    const before = this.entries.slice(0, this.index + 1).filter((entry) => !predicate(entry));
    const after = this.entries.slice(this.index + 1).filter((entry) => !predicate(entry));
    this.entries = [...before, ...after];
    this.index = before.length - 1;
  }

  get availability(): NavigationAvailability {
    return { canGoBack: this.index > 0, canGoForward: this.index >= 0 && this.index < this.entries.length - 1 };
  }
}
