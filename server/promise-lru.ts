/** Keeps the latest promise per key for one `version`; concurrent callers share it and a rejection is not kept. */
export class PromiseLru<T> {
  private readonly entries = new Map<string, { version: string; value: Promise<T> }>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, version: string, make: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    this.entries.delete(key);
    if (hit && hit.version === version) {
      this.entries.set(key, hit);
      return hit.value;
    }
    const value = make();
    this.entries.set(key, { version, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
