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
  /** Team member who answered (the typical size differs a lot between them). */
  role?: string;
}

/** How many recent requests of the same kind make "typical". */
export const TYPICAL_WINDOW = 30;
/** With fewer recent requests than this, the setup baseline is used instead. */
export const TYPICAL_MIN = 5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface UsageSummary {
  baseline: number | null;
  /** Tokens reused from Claude's prompt cache today (they cost far less). */
  todayReused: number;
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

  /**
   * "Expensive" means more than 3x what is typical for the same team member lately
   * (the median of their last 30 requests). That keeps working as apps and tools are
   * added, where a single baseline measured at setup went stale. Falls back to the
   * setup baseline until there are a few requests to compare with.
   */
  isExpensive(tokens: number, role?: string, before?: UsageEntry[]): boolean {
    const history = (before ?? this.all()).filter((e) => !e.isError && e.tokens > 0 && (role === undefined || (e.role ?? 'jarvis') === role)).slice(-TYPICAL_WINDOW);
    const typical = history.length >= TYPICAL_MIN ? median(history.map((e) => e.tokens)) : this.baselineValue;
    return typical !== null && typical > 0 && tokens > EXPENSIVE_FACTOR * typical;
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
    const start = Math.max(0, all.length - 100);
    return {
      baseline: this.baselineValue,
      todayTotal: today.reduce((s, e) => s + e.tokens, 0),
      todayReused: today.reduce((s, e) => s + (e.usage?.cacheRead ?? 0), 0),
      // each request is compared with the ones before it
      entries: all.slice(start).map((e, i) => ({ ...e, expensive: this.isExpensive(e.tokens, e.role ?? 'jarvis', all.slice(0, start + i)) })),
      topExpensive: [...today].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    };
  }
}
