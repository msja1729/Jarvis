/**
 * Which team member answers (0 tokens, on this computer):
 *  1. a role called by name: "Doctor, what should I eat?"
 *  2. else the role picked in the chat (if not "Auto")
 *  3. else by topic words
 *  4. else the role you were just talking to (follow-ups like "and tomorrow?")
 *  5. else Jarvis, the front desk
 */
import { RoleId, ROLES } from '../roles/roles.js';

export const STICKY_MS = 5 * 60 * 1000;

export interface Routed {
  role: RoleId;
  /** The text without the role's name in front. */
  text: string;
  how: 'named' | 'picked' | 'topic' | 'follow-up' | 'default';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function routeRole(
  input: string,
  picked: RoleId | null,
  last: { role: RoleId; at: number } | null,
  now = Date.now(),
  people: Partial<Record<RoleId, string>> = {},
): Routed {
  const text = input.trim();
  // 1. called by name at the start: "Sara, …", "Doctor, …", "hey PA …", "ask the teacher …"
  for (const r of ROLES) {
    const person = people[r.id] ?? r.person;
    const names = [...(r.id === 'jarvis' ? [] : [person, `dr ${person}`, `dr. ${person}`, `doctor ${person}`]), ...r.names];
    for (const n of names.sort((a, b) => b.length - a.length)) {
      const m = text.match(new RegExp(`^(?:hey |hi |ok |okay |ask (?:the |my )?|dear )?(?:the |my )?${escape(n)}\\b[\\s,:;!-]*`, 'i'));
      if (m && text.length > m[0].length) return { role: r.id, text: text.slice(m[0].length).trim(), how: 'named' };
    }
  }
  // 2. picked in the chat
  if (picked) return { role: picked, text, how: 'picked' };
  // 3. by topic: the role with the most matching words
  let best: { role: RoleId; score: number } | null = null;
  for (const r of ROLES) {
    if (r.id === 'jarvis') continue;
    const strong = text.match(new RegExp(r.topics.source, 'gi'))?.length ?? 0;
    const weak = r.weak ? (text.match(new RegExp(r.weak.source, 'gi'))?.length ?? 0) : 0;
    const hits = strong + weak / 2;
    if (hits && (!best || hits > best.score)) best = { role: r.id, score: hits };
  }
  if (best) return { role: best.role, text, how: 'topic' };
  // 4. a follow-up to the conversation you were just having
  if (last && now - last.at < STICKY_MS && last.role !== 'jarvis') return { role: last.role, text, how: 'follow-up' };
  return { role: 'jarvis', text, how: 'default' };
}
