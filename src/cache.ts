import * as crypto from 'crypto';

export interface CacheEntry {
  detected: boolean;
  vulnerability: boolean; // 后方互換
  confidence: number;
  timestamp: number;
}

export class DecisionCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;

  constructor(maxEntries: number = 2000) {
    this.maxEntries = maxEntries;
  }

  setMaxEntries(maxEntries: number) {
    this.maxEntries = Math.max(100, maxEntries);
    this.trim();
  }

  private computeKey(model: string, ruleId: string, code: string): string {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    return `${model}:${ruleId}:${hash}`;
  }

  get(model: string, ruleId: string, code: string): CacheEntry | undefined {
    const key = this.computeKey(model, ruleId, code);
    const entry = this.cache.get(key);
    if (entry) {
      // LRU: アクセスされたエントリを最新に移動
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    }
    return undefined;
  }

  set(
    model: string,
    ruleId: string,
    code: string,
    result: { detected: boolean; confidence: number }
  ): void {
    const key = this.computeKey(model, ruleId, code);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, {
      detected: result.detected,
      vulnerability: result.detected,
      confidence: result.confidence,
      timestamp: Date.now()
    });
    this.trim();
  }

  private trim() {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  clear(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  size(): number {
    return this.cache.size;
  }
}

export const decisionCache = new DecisionCache();
