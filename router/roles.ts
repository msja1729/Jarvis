/**
 * Which team member answers (0 tokens, on this computer). Jarvis is only the front desk:
 * it never answers itself, it passes every request to a member.
 *  1. a member called by name: "Sara, what should I eat?" (also when speech recognition
 *     spells the name a little differently: "Sarah", "Allen", "Viktor")
 *  2. else the member picked in the chat (if not "Auto")
 *  3. else by topic words
 *  4. else the member you were just talking to (follow-ups like "and tomorrow?")
 *  5. else Maya, the PA, who covers everything personal no one else does
 * "Jarvis, …" just means "front desk": the name is dropped and the request is routed as usual.
 */
import { RoleId, ROLES } from '../roles/roles.js';

/** Who answers when nothing else decides. */
export const FALLBACK_ROLE: RoleId = 'pa';

export const STICKY_MS = 5 * 60 * 1000;

export interface Routed {
  role: RoleId;
  /** The text without the role's name in front. */
  text: string;
  how: 'named' | 'picked' | 'topic' | 'follow-up' | 'default';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Letters only, lower case, doubled letters collapsed and a final "h" dropped: Sarah → sara, Allen → alen. */
function nameKey(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\p{L}]/gu, '')
    .replace(/(\p{L})\1+/gu, '$1')
    .replace(/(?<=\p{L}{3})h$/u, '')
    .replace(/[ck]/g, 'k');
}

/** Edit distance, for names a speech engine spelled a little differently. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Does a spoken/typed word mean this member's name? Exact, or one letter off for names of 4+ letters. */
export function soundsLike(word: string, name: string): boolean {
  const a = nameKey(word);
  const b = nameKey(name);
  if (!a || !b) return false;
  if (a === b) return true;
  return b.length >= 4 && a.length >= 4 && a[0] === b[0] && distance(a, b) <= 1;
}

const LEAD = /^(?:hey |hi |hello |ok |okay |ask (?:the |my )?|dear )?(?:the |my )?/i;

function calledByName(text: string, people: Partial<Record<RoleId, string>>): { role: RoleId; rest: string } | null {
  for (const r of ROLES) {
    const person = people[r.id] ?? r.person;
    const names = [...(r.id === 'jarvis' ? [] : [person, `dr ${person}`, `dr. ${person}`, `doctor ${person}`]), ...r.names];
    for (const n of names.sort((a, b) => b.length - a.length)) {
      const m = text.match(new RegExp(`^(?:hey |hi |hello |ok |okay |ask (?:the |my )?|dear )?(?:the |my )?${escape(n)}\\b[\\s,:;!.?-]*`, 'i'));
      if (m) return { role: r.id, rest: text.slice(m[0].length).trim() };
    }
  }
  // a name spelled a little differently ("Sarah, …"): only the person names, only as the first word
  const lead = text.match(LEAD)?.[0] ?? '';
  const first = text.slice(lead.length).match(/^(\p{L}+)[\s,:;!.?-]*/u);
  if (first) {
    for (const r of ROLES) {
      if (r.id === 'jarvis') continue;
      if (soundsLike(first[1], people[r.id] ?? r.person)) return { role: r.id, rest: text.slice(lead.length + first[0].length).trim() };
    }
  }
  return null;
}

export function routeRole(
  input: string,
  picked: RoleId | null,
  last: { role: RoleId; at: number } | null,
  now = Date.now(),
  people: Partial<Record<RoleId, string>> = {},
): Routed {
  let text = input.trim();
  // 1. called by name at the start: "Sara, …", "Doctor, …", "hey PA …", "ask the teacher …"
  const named = calledByName(text, people);
  if (named && named.role !== 'jarvis') return { role: named.role, text: named.rest || text, how: 'named' };
  // "Jarvis, …": the front desk, so route what follows
  if (named?.role === 'jarvis' && named.rest) text = named.rest;
  // 2. picked in the chat (Jarvis is not a member you can pick)
  if (picked && picked !== 'jarvis') return { role: picked, text, how: 'picked' };
  // 3. by topic: the member with the most matching words
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
  // 5. nobody in particular: the PA takes it
  return { role: FALLBACK_ROLE, text, how: 'default' };
}
