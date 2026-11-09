/**
 * Chat history shared by the chat, the voice card and the floating box, kept in the
 * user's Jarvis folder (history.jsonl) so it is there after a restart. The user can
 * switch it off or clear it in Settings. Secrets are removed before anything is saved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../roles/memory.js';

export interface HistoryItem {
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
}

export const MAX_HISTORY = 1000;

export class ChatHistory {
  constructor(
    private readonly file: string,
    private readonly enabled: () => boolean,
  ) {}

  add(items: Omit<HistoryItem, 'at'>[], now = new Date()): HistoryItem[] {
    const out = items.map((i) => ({ ...i, at: now.toISOString(), text: redact(i.text).slice(0, 8000) }));
    if (!this.enabled()) return out;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, out.map((i) => JSON.stringify(i)).join('\n') + '\n');
    this.trim();
    return out;
  }

  recent(n = 80): HistoryItem[] {
    if (!this.enabled()) return [];
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-n)
        .map((l) => JSON.parse(l) as HistoryItem);
    } catch {
      return [];
    }
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }

  /** Keeps the file to the latest MAX_HISTORY messages. */
  private trim() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      if (lines.length > MAX_HISTORY * 1.5) fs.writeFileSync(this.file, lines.slice(-MAX_HISTORY).join('\n') + '\n');
    } catch {
      /* nothing to trim */
    }
  }
}
