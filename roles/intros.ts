/**
 * The welcome after setup: Jarvis says hello, then each team member introduces themselves.
 * Claude (Haiku) writes fresh lines for each new user, so it sounds like people, not a script;
 * these hand-written ones are used if that is slow or fails.
 */
import { RoleId, roleById, ROLES } from './roles.js';
import { SKILLS } from './skills/index.js';

export const INTRO_ORDER: RoleId[] = ['jarvis', 'pa', 'pm', 'doctor', 'finance'];

export interface Intros {
  /** Jarvis's hello, before "here is your team". */
  hello: string;
  /** Each member's own introduction. */
  members: Record<Exclude<RoleId, 'jarvis'>, string>;
  /** Jarvis's last words, handing over to the user. */
  outro: string;
}

type People = Record<RoleId, string>;

/** Hand-written introductions, with the names the user chose. */
export function fallbackIntros(people: People, user?: string): Intros {
  const you = user ? `, ${user}` : '';
  const hey = user ? `Hey ${user}!` : 'Hey there!';
  return {
    hello: `${hey} I'm Jarvis. Think of me as the front desk of your own little AI team, living right here on your computer. You ask, by typing or just by talking, and I get the right expert on it. Your stuff stays on this machine, and nothing happens without your say. Okay, enough about me. Let me introduce the team.`,
    members: {
      pa: `Hi${you}! I'm ${people.pa}, your personal assistant. Calendar, emails, deadlines, the boring admin stuff, I've got it. I'll plan your mornings, pull deadlines out of your inbox, and remind you before things sneak up on you. Honestly, keeping you organised is lowkey my favourite thing.`,
      pm: `Yo, ${people.pm} here, your project manager. Give me an idea and I'll turn it into a plan, run the coding with Claude Code, and keep you posted. Record a meeting and I'll write the minutes and track every task that lands on you. I think with Opus, so building things is kind of my thing.`,
      doctor: `Hi${you}, I'm ${people.doctor}, your health buddy. Food, sleep, workouts, that weird headache, or a blood report that looks like a different language, I'll explain it in plain words using trusted medical sources. I'm not a replacement for your real doctor, but I'll always tell you when it's time to see one. And hey, drink some water.`,
      finance: `Hey, ${people.finance} here, your money person. Budgets, savings, loans, investing basics, even that startup idea of yours, I'll run the numbers and show you the maths simply. Not official financial advice, more like a friend who's weirdly good with spreadsheets. Let's get your money working, responsibly.`,
    },
    outro: `And that's the squad! We talk to each other, we keep our notes in our own folders, and we're here whenever you need us. So${you}, what should we start with?`,
  };
}

/** The request to Claude for fresh introductions. */
export function introPrompt(people: People, user?: string): { prompt: string; system: string } {
  const who = ROLES.filter((r) => r.id !== 'jarvis')
    .map((r) => `- ${r.id}: ${people[r.id]}, the ${r.title.toLowerCase()} ("${r.name}"). ${r.blurb} Skills: ${SKILLS[r.id].map((s) => s.id.replace(/-/g, ' ')).join(', ')}.${r.model === 'opus' ? ' Runs on Opus, the strongest model.' : ''}`)
    .join('\n');
  const system = `You write short spoken introductions for a desktop AI team, read aloud by natural voices. Sound like real, warm people talking, not a script or an ad: contractions, a little humour, light Gen Z flavour is welcome (e.g. "lowkey", "no cap", "I got you") but at most one such phrase per speaker, and never cringe. Plain spoken text only: no emojis, no markdown, no lists, no stage directions. Reply with JSON only.`;
  const prompt = `The user${user ? ` is called ${user}` : "'s name is unknown"}. They just installed Jarvis and finished setup.
Jarvis is the front desk: it answers general questions and passes the rest to the right expert. Everything runs on the user's computer and nothing happens without their OK.
The team:
${who}

Write:
- hello: Jarvis greets the user${user ? ' by name' : ''}, says what Jarvis is in a sentence or two, and leads into introducing the team. 45-70 words.
- one introduction per member, in first person, starting with their name: what they do and how they'll help, in a friendly human way. 40-65 words each. The doctor says they don't replace a real doctor; finance says it isn't official financial advice.
- outro: Jarvis wraps up warmly and asks what to start with. 20-35 words.

JSON shape: {"hello": "...", "pa": "...", "pm": "...", "doctor": "...", "finance": "...", "outro": "..."}`;
  return { prompt, system };
}

const MAX_CHARS = 600;

/** Reads Claude's reply. Anything missing, too long or odd falls back to the hand-written line. */
export function parseIntros(raw: string | null, fallback: Intros): Intros {
  if (!raw) return fallback;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return fallback;
  }
  const ok = (v: unknown, min: number): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= MAX_CHARS && !/[*#`<>{}[\]]/.test(v);
  const clean = (v: string) => v.replace(/\s+/g, ' ').trim();
  const members = { ...fallback.members };
  for (const id of Object.keys(members) as (keyof Intros['members'])[]) if (ok(j[id], 60)) members[id] = clean(j[id] as string);
  return {
    hello: ok(j.hello, 60) ? clean(j.hello as string) : fallback.hello,
    members,
    outro: ok(j.outro, 20) ? clean(j.outro as string) : fallback.outro,
  };
}

/** What each member's card shows during the intro. */
export function introCards(people: People) {
  return INTRO_ORDER.filter((r) => r !== 'jarvis').map((id) => {
    const r = roleById(id);
    return { id, person: people[id], name: r.name, title: r.title, color: r.color, skills: SKILLS[id].map((s) => s.id.replace(/-/g, ' ')), model: r.model === 'opus' ? 'Opus 5.5' : null };
  });
}
