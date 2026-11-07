import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CacheLocationType, LinterConfig } from './config';

export interface CacheEntry {
  detected: boolean;
  vulnerability: boolean; // 后方互換
  confidence: number;
  timestamp: number;
}

export class DecisionCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private persistPath: string | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;
  private currentLocation: CacheLocationType = 'global';
  private extensionContext: vscode.ExtensionContext | null = null;

  constructor(maxEntries: number = 2000) {
    this.maxEntries = maxEntries;
  }

  async initialize(context: vscode.ExtensionContext, config: LinterConfig): Promise<void> {
    this.extensionContext = context;
    this.setMaxEntries(config.cacheMaxEntries);
    await this.configureLocation(config.cacheLocation);
  }

  async configureLocation(location: CacheLocationType): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      await this.saveNow();
    }

    this.currentLocation = location;
    this.persistPath = null;

    if (location === 'memory') {
      return;
    }

    if (location === 'global') {
      if (this.extensionContext) {
        const dir = this.extensionContext.globalStorageUri.fsPath;
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          this.persistPath = path.join(dir, 'decision-cache.json');
        } catch (e) {
          console.warn('Jev Linter: Failed to initialize global storage directory:', e);
        }
      }
    } else if (location === 'workspace') {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const root = folders[0].uri.fsPath;
        const vscodeDir = path.join(root, '.vscode');
        try {
          if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
          }
          this.persistPath = path.join(vscodeDir, '.jev-cache.json');
        } catch (e) {
          console.warn('Jev Linter: Failed to initialize .vscode directory:', e);
        }
      } else if (this.extensionContext) {
        const dir = this.extensionContext.globalStorageUri.fsPath;
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          this.persistPath = path.join(dir, 'decision-cache.json');
        } catch {}
      }
    }

    await this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) {
      return;
    }
    try {
      const data = fs.readFileSync(this.persistPath, 'utf8');
      const json = JSON.parse(data);
      if (typeof json === 'object' && json !== null) {
        for (const [key, entry] of Object.entries(json)) {
          if (entry && typeof entry === 'object') {
            const e = entry as any;
            this.cache.set(key, {
              detected: Boolean(e.detected ?? e.vulnerability),
              vulnerability: Boolean(e.detected ?? e.vulnerability),
              confidence: Number(e.confidence || 0),
              timestamp: Number(e.timestamp || Date.now())
            });
          }
        }
        this.trim();
      }
    } catch (e) {
      console.warn(`Jev Linter: Failed to read cache file at ${this.persistPath}:`, e);
    }
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
    this.scheduleSave();
  }

  private scheduleSave() {
    if (!this.persistPath || this.currentLocation === 'memory') {
      return;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveNow().catch((e) => {
        console.warn('Jev Linter: Async cache save failed:', e);
      });
    }, 2000);
  }

  async saveNow(): Promise<void> {
    if (!this.persistPath || this.currentLocation === 'memory') {
      return;
    }
    try {
      const obj: Record<string, CacheEntry> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.warn(`Jev Linter: Failed to write cache to ${this.persistPath}:`, e);
    }
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

  async clear(): Promise<number> {
    const count = this.cache.size;
    this.cache.clear();
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.persistPath && fs.existsSync(this.persistPath)) {
      try {
        fs.unlinkSync(this.persistPath);
      } catch (e) {
        console.warn(`Jev Linter: Failed to delete cache file ${this.persistPath}:`, e);
      }
    }
    return count;
  }

  size(): number {
    return this.cache.size;
  }

  getPersistPath(): string | null {
    return this.persistPath;
  }
}

export const decisionCache = new DecisionCache();

