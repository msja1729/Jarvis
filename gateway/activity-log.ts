/** Activity log: every Gateway decision and executed action, with a timestamp (criterion 33). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ActivityOutcome = 'done' | 'blocked' | 'declined' | 'error';

export interface ActivityEntry {
  /** Stable id, so the user can select and delete entries. Old entries get one when read. */
  id: string;
  ts: string;
  /** The team member who used the tool (jarvis, pa, educator…). */
  role?: string;
  appId: string;
  ability: string;
  outcome: ActivityOutcome;
  /** Short, credential-free description. */
  detail: string;
}

/** An id for entries written before ids existed: the same entry always gets the same id. */
const legacyId = (e: Omit<ActivityEntry, 'id'>, line: number) =>
  crypto.createHash('sha1').update(`${line}|${e.ts}|${e.appId}|${e.ability}|${e.outcome}|${e.detail}`).digest('hex').slice(0, 16);

export class ActivityLog {
  private memory: ActivityEntry[] = [];

  constructor(private readonly file: string | null) {}

  add(entry: Omit<ActivityEntry, 'ts' | 'id'>): ActivityEntry {
    const full: ActivityEntry = { id: crypto.randomUUID(), ts: new Date().toISOString(), ...entry };
    this.memory.push(full);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(full) + '\n');
    }
    return full;
  }

  /** Every entry on disk (or in memory), oldest first. Broken lines are skipped. */
  private all(): ActivityEntry[] {
    if (!this.file || !fs.existsSync(this.file)) return this.memory;
    const out: ActivityEntry[] = [];
    fs.readFileSync(this.file, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (!l.trim()) return;
        try {
          const e = JSON.parse(l) as ActivityEntry;
          out.push(e.id ? e : { ...e, id: legacyId(e, i) });
        } catch {
          /* skip a damaged line */
        }
      });
    return out;
  }

  list(limit = 500): ActivityEntry[] {
    return this.all().slice(-limit);
  }

  /** Deletes entries for good: they are removed from the file on disk, not just hidden. Returns how many. */
  remove(ids: string[]): number {
    const drop = new Set(ids);
    const all = this.all();
    const keep = all.filter((e) => !drop.has(e.id));
    this.write(keep);
    return all.length - keep.length;
  }

  /** Deletes the whole activity history from this computer. */
  clear(): void {
    this.write([]);
  }

  private write(entries: ActivityEntry[]) {
    this.memory = this.file ? [] : entries;
    if (!this.file) return;
    if (!entries.length) {
      fs.rmSync(this.file, { force: true });
      return;
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.renameSync(tmp, this.file);
  }
}
