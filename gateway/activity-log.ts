/** Activity log: every Gateway decision and executed action, with a timestamp (criterion 33). */
import fs from 'node:fs';
import path from 'node:path';

export type ActivityOutcome = 'done' | 'blocked' | 'declined' | 'error';

export interface ActivityEntry {
  ts: string;
  appId: string;
  ability: string;
  outcome: ActivityOutcome;
  /** Short, credential-free description. */
  detail: string;
}

export class ActivityLog {
  private memory: ActivityEntry[] = [];

  constructor(private readonly file: string | null) {}

  add(entry: Omit<ActivityEntry, 'ts'>): ActivityEntry {
    const full: ActivityEntry = { ts: new Date().toISOString(), ...entry };
    this.memory.push(full);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(full) + '\n');
    }
    return full;
  }

  list(limit = 200): ActivityEntry[] {
    if (!this.file || !fs.existsSync(this.file)) return this.memory.slice(-limit);
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as ActivityEntry);
  }
}
