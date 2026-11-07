/** Usage log and baseline (SPEC 5.1, criterion 18). */
import fs from 'node:fs';
import path from 'node:path';
import type { TokenUsage } from './brain.js';

export const EXPENSIVE_FACTOR = 3;

export interface UsageEntry {
  ts: string;
  request: string;
  model: string;
  tokens: number;
  usage?: TokenUsage;
  isError: boolean;
}

export interface UsageSummary {
  baseline: number | null;
  todayTotal: number;
  entries: (UsageEntry & { expensive: boolean })[];
  topExpensive: UsageEntry[];
}

export class UsageLog {
  private memory: UsageEntry[] = [];
  private baselineValue: number | null = null;

  constructor(
    private readonly file: string | null,
    private readonly baselineFile: string | null,
  ) {
    if (baselineFile && fs.existsSync(baselineFile)) {
      try {
        this.baselineValue = JSON.parse(fs.readFileSync(baselineFile, 'utf8')).tokens ?? null;
      } catch {
        this.baselineValue = null;
      }
    }
  }

  get baseline(): number | null {
    return this.baselineValue;
  }

  setBaseline(tokens: number): void {
    this.baselineValue = tokens;
    if (this.baselineFile) {
      fs.mkdirSync(path.dirname(this.baselineFile), { recursive: true });
      fs.writeFileSync(this.baselineFile, JSON.stringify({ tokens, ts: new Date().toISOString() }));
    }
  }

  add(e: Omit<UsageEntry, 'ts'>, now = new Date()): UsageEntry {
    const full: UsageEntry = { ts: now.toISOString(), ...e, request: e.request.slice(0, 120) };
    this.memory.push(full);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(full) + '\n');
    }
    return full;
  }

  isExpensive(tokens: number): boolean {
    return this.baselineValue !== null && this.baselineValue > 0 && tokens > EXPENSIVE_FACTOR * this.baselineValue;
  }

  all(): UsageEntry[] {
    if (!this.file || !fs.existsSync(this.file)) return [...this.memory];
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UsageEntry);
  }

  summary(now = new Date()): UsageSummary {
    const all = this.all();
    const day = now.toDateString();
    const today = all.filter((e) => new Date(e.ts).toDateString() === day);
    return {
      baseline: this.baselineValue,
      todayTotal: today.reduce((s, e) => s + e.tokens, 0),
      entries: all.slice(-100).map((e) => ({ ...e, expensive: this.isExpensive(e.tokens) })),
      topExpensive: [...today].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    };
  }
}
