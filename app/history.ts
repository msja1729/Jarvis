/**
 * Chat history, organised into conversations, kept in the user's Jarvis folder:
 *   history.jsonl       every message, tagged with its conversation id
 *   conversations.json  one entry per conversation: title, dates, who took part, Claude sessions
 * Shared by the chat, the voice card and the floating box. Each start of Jarvis begins a fresh
 * conversation; one also starts after GAP_MS without messages, or when the user asks.
 * The user can open, continue, search and delete conversations (for good), or switch history off.
 * Secrets are removed before anything is saved.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../roles/memory.js';

export interface HistoryItem {
  id: string;
  /** The conversation it belongs to. */
  conv: string;
  at: string;
  who: 'user' | 'assistant';
  text: string;
  /** "Sara · Doctor" for replies. */
  roleName?: string;
  color?: string;
  /** Where it was said: the chat, the voice card or the floating box. */
  via: 'chat' | 'voice' | 'box';
  meta?: string;
  error?: boolean;
  /** Files the member showed the user in the preview while answering (reopened from the chat). */
  shown?: ShownSet[];
}

/** One set of files shown in the preview. */
export interface ShownSet {
  title: string;
  files: { name: string; rel: string; url: string; kind: string; size: number }[];
}

export interface Conversation {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  count: number;
  /** Who answered in it ("Sara · Doctor" and their colour), in order of first reply. */
  people: { name: string; color: string }[];
  /** The Claude session each team member used, so the conversation can be continued. */
  sessions: Record<string, string>;
}

/** A new conversation starts after this long without messages. */
export const GAP_MS = 30 * 60 * 1000;
/** Oldest conversations are dropped beyond this many messages. */
export const MAX_MESSAGES = 5000;
export const TITLE_CHARS = 60;

export type NewItem = Omit<HistoryItem, 'at' | 'id' | 'conv'>;

/** "Sara, I have had a headache…" → "I have had a headache…" (60 characters, whole words). */
export function makeTitle(text: string): string {
  const t = text
    .replace(/\s+/g, ' ')
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/^(hey |hi |ok |okay )?[\p{L}.]{2,20}, /iu, '')
    .trim();
  if (!t) return 'New conversation';
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  if (cap.length <= TITLE_CHARS) return cap;
  const cut = cap.lastIndexOf(' ', TITLE_CHARS - 1);
  return `${cap.slice(0, cut > 30 ? cut : TITLE_CHARS - 1)}…`;
}

export class ChatHistory {
  private convs: Conversation[] | null = null;
  /** The conversation new messages go to; null = the next message starts a new one. */
  private current: string | null = null;
  /** When the current conversation was last used or continued. */
  private lastTouch = 0;

  constructor(
    private readonly file: string,
    private readonly indexFile: string,
    private readonly enabled: () => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ---------- storage ---------- */

  private readItems(): HistoryItem[] {
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as HistoryItem];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private writeItems(items: HistoryItem[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!items.length) {
      fs.rmSync(this.file, { force: true });
      return;
    }
    fs.writeFileSync(`${this.file}.tmp`, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  private saveIndex() {
    if (!this.enabled()) return;
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    fs.writeFileSync(`${this.indexFile}.tmp`, JSON.stringify(this.convs ?? [], null, 1));
    fs.renameSync(`${this.indexFile}.tmp`, this.indexFile);
  }

  /** Loads the index; history from before conversations existed is split by time gaps once. */
  private index(): Conversation[] {
    if (this.convs) return this.convs;
    try {
      this.convs = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) as Conversation[];
    } catch {
      this.convs = [];
    }
    const items = this.readItems();
    if (items.some((i) => !i.conv || !i.id)) this.migrate(items);
    return this.convs;
  }

  private migrate(items: HistoryItem[]) {
    let conv: Conversation | null = null;
    let last = 0;
    for (const i of items) {
      i.id ||= crypto.randomUUID();
      const t = Date.parse(i.at) || 0;
      if (i.conv && this.convs!.some((c) => c.id === i.conv)) {
        conv = this.convs!.find((c) => c.id === i.conv)!;
      } else if (!i.conv) {
        if (!conv || t - last > GAP_MS) {
          conv = this.newConv(i.at, i.who === 'user' ? i.text : '');
          this.convs!.push(conv);
        }
        i.conv = conv.id;
        this.track(conv, i);
      }
      last = t;
    }
    this.writeItems(items);
    this.saveIndex();
  }

  private newConv(at: string, firstText: string): Conversation {
    return { id: crypto.randomUUID(), title: firstText ? makeTitle(firstText) : 'New conversation', startedAt: at, updatedAt: at, count: 0, people: [], sessions: {} };
  }

  private track(c: Conversation, i: HistoryItem) {
    c.count += 1;
    c.updatedAt = i.at;
    if (c.title === 'New conversation' && i.who === 'user') c.title = makeTitle(i.text);
    if (i.who === 'assistant' && i.roleName && !c.people.some((p) => p.name === i.roleName)) c.people.push({ name: i.roleName, color: i.color ?? '#9a9a96' });
  }

  /* ---------- conversations ---------- */

  get currentId(): string | null {
    return this.current;
  }

  /**
   * Called before a message: the conversation it belongs to. Starts a new one when there is
   * none yet, or the last message was more than GAP_MS ago. isNew tells the caller to start
   * fresh Claude sessions too.
   */
  prepare(): { conv: string; isNew: boolean } {
    const now = this.now().getTime();
    const cur = this.current ? this.index().find((c) => c.id === this.current) : undefined;
    if (this.current && (cur || !this.enabled()) && now - this.lastTouch <= GAP_MS) {
      this.lastTouch = now;
      return { conv: this.current, isNew: false };
    }
    const at = this.now().toISOString();
    const c = this.newConv(at, '');
    if (this.enabled()) this.index().push(c);
    this.current = c.id;
    this.lastTouch = now;
    return { conv: c.id, isNew: true };
  }

  /** The next message starts a new conversation ("New chat"). */
  startNew(): void {
    this.current = null;
  }

  /** Makes an earlier conversation the current one again. Returns its Claude sessions. */
  continue(id: string): Conversation {
    const c = this.index().find((x) => x.id === id);
    if (!c) throw new Error('That conversation no longer exists.');
    this.current = id;
    this.lastTouch = this.now().getTime();
    return c;
  }

  /** Saves messages in the current conversation (starting one if needed). */
  add(items: NewItem[]): HistoryItem[] {
    const { conv } = this.current ? { conv: this.current } : this.prepare();
    const at = this.now().toISOString();
    const out: HistoryItem[] = items.map((i) => ({ ...i, id: crypto.randomUUID(), conv, at, text: redact(i.text).slice(0, 8000) }));
    this.lastTouch = this.now().getTime();
    if (!this.enabled()) return out;
    const c = this.index().find((x) => x.id === conv);
    if (!c) return out;
    for (const i of out) this.track(c, i);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, out.map((i) => JSON.stringify(i)).join('\n') + '\n');
    this.trim();
    this.saveIndex();
    return out;
  }

  /** Remembers the Claude session a team member used in a conversation. */
  setSession(conv: string, role: string, sessionId: string | null | undefined): void {
    if (!sessionId || !this.enabled()) return;
    const c = this.index().find((x) => x.id === conv);
    if (!c || c.sessions[role] === sessionId) return;
    c.sessions[role] = sessionId;
    this.saveIndex();
  }

  /** Conversations, newest first. With a query: those whose title or messages contain it. */
  list(query = ''): Conversation[] {
    if (!this.enabled()) return [];
    const all = this.index().filter((c) => c.count > 0);
    const q = query.trim().toLowerCase();
    let out = all;
    if (q) {
      const hit = new Set(this.readItems().filter((i) => i.text.toLowerCase().includes(q)).map((i) => i.conv));
      out = all.filter((c) => hit.has(c.id) || c.title.toLowerCase().includes(q));
    }
    return [...out].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  messages(id: string): HistoryItem[] {
    if (!this.enabled()) return [];
    return this.readItems().filter((i) => i.conv === id);
  }

  get(id: string): Conversation | undefined {
    return this.index().find((c) => c.id === id);
  }

  /** Deletes conversations for good (messages and index entry). Returns how many. */
  remove(ids: string[]): number {
    const drop = new Set(ids);
    const before = this.index().length;
    this.convs = this.index().filter((c) => !drop.has(c.id));
    this.writeItems(this.readItems().filter((i) => !drop.has(i.conv)));
    this.saveIndex();
    if (this.current && drop.has(this.current)) this.current = null;
    return before - this.convs.length;
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
    fs.rmSync(this.indexFile, { force: true });
    this.convs = [];
    this.current = null;
  }

  /** Keeps at most MAX_MESSAGES by dropping the oldest whole conversations. */
  private trim() {
    const items = this.readItems();
    if (items.length <= MAX_MESSAGES) return;
    const order = [...this.index()].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    let extra = items.length - MAX_MESSAGES;
    const drop: string[] = [];
    for (const c of order) {
      if (extra <= 0 || c.id === this.current) break;
      drop.push(c.id);
      extra -= c.count;
    }
    if (drop.length) this.remove(drop);
  }
}
