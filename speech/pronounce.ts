/**
 * How names should sound. The natural voice reads words by English spelling rules, so many
 * names (Indian names especially) come out wrong. The user (helped by a suggestion from
 * Claude) gives a "say it like" spelling, and the voice uses it wherever the name appears.
 * Only what is spoken changes; what is written stays the real name.
 */

/** Whole-word, case-insensitive replacement of each name by how it should sound. */
export function applyPronunciations(text: string, map: Record<string, string> | undefined): string {
  if (!map) return text;
  let out = text;
  for (const [word, sayAs] of Object.entries(map)) {
    if (!word.trim() || !sayAs.trim()) continue;
    const esc = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // letters around the match mean it is part of another word ("Jyo" inside "Jyothi")
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), sayAs.trim());
  }
  return out;
}

/** A "say it like" spelling: letters, spaces, hyphens and apostrophes, up to 60 characters. */
export const SAY_AS = /^[\p{L} '.-]{1,60}$/u;

/**
 * The request to Claude for a spelling the English voice will read correctly.
 * Every example was checked against the voice's own phonemizer (espeak, en-us).
 */
export function respellPrompt(name: string): { prompt: string; system: string } {
  return {
    system:
      'You help an English text-to-speech voice (espeak-based, American English) pronounce names correctly. Reply with only the respelling on one line: plain English letters, no IPA, no quotes, no explanation.',
    prompt: `Respell the name "${name}" so an English text-to-speech voice says it the way a native speaker of the name's language does (it may well be an Indian name).
Rules, because the voice reads by English spelling:
- Split into 2-4 chunks joined by hyphens; every chunk must look like an English word or syllable a reader would say confidently (e.g. "Joe", "tee", "raa", "dit"). Never start a chunk with an odd cluster like "shm" or "jy"; join it to the previous chunk instead ("Lukshmee").
- Vowels: "ee" as in see, "oo" as in moon, "aa" as in father, "uh" as in cup, "ay" as in day, "oe"/"oh" as in go. Never leave a bare "i" or "a" that English could read as "eye" or "ay".
- Indian "th"/"dh" are soft dental sounds: write "t"/"d", never "th" (English would say "thin"/"this").
- "Jy"/"Jyo" at the start: write "Joe"; "Ksh": "Ksh" inside a chunk ("Lukshmee").
Checked examples: Priyanka → Pree-yaan-kaa; Lakshmi → Lukshmee; Aishwarya → Ash-waar-ya; Siddharth → Sid-daart; Gaurav → Gow-rav; Aadimulam → Aa-dee-moo-lum.`,
  };
}

/** Consonant pairs English words can start with; other clusters get spelled out letter by letter. */
const ONSETS = /^(bl|br|ch|cl|cr|dr|fl|fr|gl|gr|kl|kr|ph|pl|pr|sc|sh|sk|sl|sm|sn|sp|st|sw|th|tr|tw|wh|wr|qu)/;
const VOWEL = /[aeiouy]/;

/**
 * Fixes the usual slips in a respelling, so each chunk reads like English:
 * a chunk starting with an odd consonant cluster gives its first consonant to the chunk before
 * ("Ve-nkaa" → "Ven-kaa"), and a chunk ending in a bare "i"/"u" gets a long vowel ("Ti" → "Tee").
 */
export function tidyRespelling(s: string): string {
  const chunks = s.split('-').filter(Boolean);
  for (let k = 1; k < chunks.length; k++) {
    const c = chunks[k];
    const lead = c.match(/^[^aeiouy]+/i)?.[0] ?? '';
    if (lead.length >= 2 && !ONSETS.test(c.toLowerCase()) && VOWEL.test(chunks[k - 1].toLowerCase())) {
      chunks[k - 1] += c[0];
      chunks[k] = c.slice(1);
    }
  }
  const fixed = chunks.map((c) => c.replace(/([^aeiouy])i$/i, '$1ee').replace(/([^aeiouy])u$/i, '$1oo'));
  const out = fixed.join('-');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Cleans Claude's reply: one line, only allowed characters; null if unusable. */
export function parseRespelling(raw: string | null, name: string): string | null {
  if (!raw) return null;
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const clean = line.replace(/^["'“”]+|["'“”.]+$/g, '').replace(/^.*?(→|->|:)\s*/, '').trim();
  if (!clean || !SAY_AS.test(clean) || clean.toLowerCase() === name.toLowerCase()) return null;
  return clean.includes(' ') ? clean : tidyRespelling(clean);
}
