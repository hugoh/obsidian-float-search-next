interface Entry {
  mtime: number;
  text: string;
  bytes: number;
}

export interface ContentCacheLimits {
  maxEntries: number;
  maxBytes: number;
}

const DEFAULT_LIMITS: ContentCacheLimits = {
  maxEntries: 2000,
  maxBytes: 64 * 1024 * 1024,
};

/** File bodies keyed by path and validated by modification time, bounded by count and size (LRU). */
export class ContentCache {
  private entries = new Map<string, Entry>();
  private total = 0;
  private readonly limits: ContentCacheLimits;

  constructor(limits: Partial<ContentCacheLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.total;
  }

  get(path: string, mtime: number): string | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    if (entry.mtime !== mtime) {
      this.delete(path);
      return undefined;
    }
    // Re-insert so the Map's insertion order doubles as recency.
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.text;
  }

  set(path: string, mtime: number, text: string): void {
    this.delete(path);
    const bytes = text.length * 2;
    if (bytes > this.limits.maxBytes) return;
    this.entries.set(path, { mtime, text, bytes });
    this.total += bytes;
    for (const oldest of this.entries.keys()) {
      if (
        this.entries.size <= this.limits.maxEntries &&
        this.total <= this.limits.maxBytes
      ) {
        break;
      }
      this.delete(oldest);
    }
  }

  delete(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    this.total -= entry.bytes;
    this.entries.delete(path);
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}
