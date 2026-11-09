/**
 * Understands the user's reply to a supervisor question, typed or spoken:
 * "yes", "no, use the other folder", "the second one", "SQLite", "go with yours".
 */
export interface Option {
  label: string;
  description?: string;
}

export type Reading =
  | { kind: 'allow'; note?: string }
  | { kind: 'deny'; note?: string }
  | { kind: 'choose'; labels: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'unclear' };

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|alright|all right|go ahead|go for it|allow( it)?|approve(d)?|do it|fine|proceed|sounds good|agreed?|correct|right)\b[\s,.!]*/i;
const NO = /^(no|nope|nah|don'?t|do not|deny|denied|stop|cancel|skip|reject(ed)?|not now|wait|hold on|never)\b[\s,.!]*/i;
const THEIRS = /\b(your (pick|choice|recommendation|suggestion|option)|(go|stick) with (yours|your|what you (said|suggested|recommend))|whatever you (think|recommend|suggest)|as you (said|suggest)|you decide|recommended( one)?)\b/i;
const ORDINALS: Record<string, number> = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, last: -1 };

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+#.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** For yes/no questions (permissions, plans). Anything after the yes/no is kept as a note for Claude. */
export function readPermission(text: string): Reading {
  const t = text.trim();
  const tail = (m: RegExpMatchArray) => t.slice(m[0].length).trim() || undefined;
  const no = t.match(NO);
  if (no) return { kind: 'deny', note: tail(no) };
  const yes = t.match(YES);
  if (yes) return { kind: 'allow', note: tail(yes) };
  return { kind: 'unclear' };
}

/** For multiple-choice questions. Free text is passed on to Claude as the answer. */
export function readChoice(text: string, options: Option[], recommended?: string, multi = false): Reading {
  // "the second one" means 2, not 2 and 1
  const t = clean(text).replace(/\b(first|second|third|fourth|last|other|1st|2nd|3rd|4th)\s+(one|option|choice)\b/g, '$1');
  // "the other one", with two options and a recommendation, means the one Jarvis did not pick
  if (/\b(the )?other\b/.test(t) && options.length === 2 && recommended && t.split(' ').length <= 4) {
    const other = options.find((o) => o.label !== recommended);
    if (other) return { kind: 'choose', labels: [other.label] };
  }
  if (!t) return { kind: 'unclear' };
  if (THEIRS.test(text) && recommended) return { kind: 'choose', labels: [recommended] };
  if (YES.test(text.trim()) && recommended && clean(text.trim().replace(YES, '')) === '') return { kind: 'choose', labels: [recommended] };
  const picked = new Set<string>();
  // by position: "option 2", "the second one", "2"
  const nums = [...t.matchAll(/\b(?:option|number|no\.?|choice)?\s*(\d)\b/g)].map((m) => Number(m[1]));
  for (const [w, n] of Object.entries(ORDINALS)) if (new RegExp(`\\b${w}\\b`).test(t)) nums.push(n);
  for (const n of nums) {
    const i = n === -1 ? options.length - 1 : n - 1;
    if (options[i]) picked.add(options[i].label);
  }
  // by name: "sqlite", "go with French"
  for (const o of options) {
    const l = clean(o.label);
    if (l && (t === l || new RegExp(`(^|\\s)${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(t))) picked.add(o.label);
  }
  if (picked.size && (multi || picked.size === 1)) {
    // a short reply that names an option is a choice; a long one with extra wishes goes to Claude as text
    const extra = t.split(' ').length > Math.max(6, ...[...picked].map((l) => l.split(' ').length + 4));
    if (!extra) return { kind: 'choose', labels: [...picked] };
  }
  return { kind: 'text', text: text.trim() };
}
