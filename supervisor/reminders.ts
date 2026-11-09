/**
 * Reminders (the PA's) and the project board (shared by the PA and the Project
 * Manager), stored as small JSON files in the user's Jarvis folder.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const newId = () => crypto.randomBytes(4).toString('hex');

/* ---------- reminders ---------- */

export interface Reminder {
  id: string;
  text: string;
  /** ISO 8601 time. */
  at: string;
  fired?: boolean;
}

export const MAX_REMINDERS = 200;
/** Reminders missed while Jarvis was closed are still given if they are this recent. */
export const MISSED_GRACE_MS = 2 * 60 * 60 * 1000;

export class ReminderStore {
  constructor(private readonly file: string) {}

  all(): Reminder[] {
    return readJson<Reminder[]>(this.file, []);
  }

  upcoming(now = Date.now()): Reminder[] {
    return this.all()
      .filter((r) => !r.fired && Date.parse(r.at) > now - MISSED_GRACE_MS)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  add(text: string, at: string, now = Date.now()): Reminder {
    const t = Date.parse(at);
    if (!text.trim()) throw new Error('Say what to remind the user about.');
    if (!Number.isFinite(t)) throw new Error('Give the time as ISO 8601 with the offset, e.g. 2026-11-09T17:50:00+05:30.');
    if (t < now - 60_000) throw new Error('That time has already passed.');
    const list = this.all().filter((r) => !r.fired || Date.parse(r.at) > now - 86_400_000);
    if (list.length >= MAX_REMINDERS) throw new Error('There are too many reminders; cancel some first.');
    const r: Reminder = { id: newId(), text: text.trim().slice(0, 300), at: new Date(t).toISOString() };
    list.push(r);
    writeJson(this.file, list);
    return r;
  }

  cancel(id: string): boolean {
    const list = this.all();
    const next = list.filter((r) => r.id !== id);
    writeJson(this.file, next);
    return next.length !== list.length;
  }

  /** Reminders whose time has come; they are marked as given. Old missed ones are dropped quietly. */
  takeDue(now = Date.now()): Reminder[] {
    const list = this.all();
    const due: Reminder[] = [];
    let changed = false;
    for (const r of list) {
      const t = Date.parse(r.at);
      if (r.fired || t > now) continue;
      r.fired = true;
      changed = true;
      if (t > now - MISSED_GRACE_MS) due.push(r);
    }
    if (changed) writeJson(this.file, list);
    return due;
  }
}

/* ---------- project board ---------- */

export const TASK_STATUS = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export interface Task {
  id: string;
  title: string;
  project?: string;
  status: TaskStatus;
  /** YYYY-MM-DD */
  due?: string;
  notes?: string;
  updated: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BoardStore {
  constructor(private readonly file: string) {}

  all(): Task[] {
    return readJson<Task[]>(this.file, []);
  }

  list(filter: { project?: string; status?: string } = {}): Task[] {
    return this.all().filter((t) => (!filter.project || t.project?.toLowerCase() === filter.project.toLowerCase()) && (!filter.status || t.status === filter.status));
  }

  add(input: { title: string; project?: string; status?: string; due?: string; notes?: string }): Task {
    const title = input.title?.trim();
    if (!title) throw new Error('A task needs a title.');
    const list = this.all();
    if (list.length >= 500) throw new Error('The board is full; remove some done tasks first.');
    const t: Task = {
      id: newId(),
      title: title.slice(0, 200),
      project: input.project?.trim().slice(0, 60) || undefined,
      status: (TASK_STATUS as readonly string[]).includes(input.status ?? '') ? (input.status as TaskStatus) : 'todo',
      due: input.due && DATE.test(input.due) ? input.due : undefined,
      notes: input.notes?.trim().slice(0, 500) || undefined,
      updated: new Date().toISOString(),
    };
    list.push(t);
    writeJson(this.file, list);
    return t;
  }

  update(id: string, patch: { title?: string; project?: string; status?: string; due?: string | null; notes?: string }): Task {
    const list = this.all();
    const t = list.find((x) => x.id === id);
    if (!t) throw new Error(`No task with id ${id}.`);
    if (patch.title?.trim()) t.title = patch.title.trim().slice(0, 200);
    if (patch.project !== undefined) t.project = patch.project.trim().slice(0, 60) || undefined;
    if (patch.status && (TASK_STATUS as readonly string[]).includes(patch.status)) t.status = patch.status as TaskStatus;
    if (patch.due === null || patch.due === '') t.due = undefined;
    else if (patch.due && DATE.test(patch.due)) t.due = patch.due;
    if (patch.notes !== undefined) t.notes = patch.notes.trim().slice(0, 500) || undefined;
    t.updated = new Date().toISOString();
    writeJson(this.file, list);
    return t;
  }

  remove(id: string): boolean {
    const list = this.all();
    const next = list.filter((t) => t.id !== id);
    writeJson(this.file, next);
    return next.length !== list.length;
  }

  /** One line per task, for Claude. */
  static describe(tasks: Task[]): string {
    if (!tasks.length) return 'The board is empty.';
    return tasks.map((t) => `[${t.id}] ${t.status.toUpperCase()} ${t.title}${t.project ? ` (${t.project})` : ''}${t.due ? ` due ${t.due}` : ''}`).join('\n');
  }
}
