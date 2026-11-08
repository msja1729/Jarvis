/**
 * Splits a spoken reply into pieces the voice engine turns into audio one by one.
 * The first piece is kept short so the voice starts quickly; later pieces are
 * longer but still bounded, because the engine slows down sharply on long input.
 * Long sentences are cut at commas or semicolons, where a short pause sounds natural.
 */
import { TextSplitterStream } from 'kokoro-js';

export const FIRST_CHUNK_CHARS = 80;
export const CHUNK_CHARS = 220;

export function sentences(text: string): string[] {
  const s = new TextSplitterStream();
  s.push(text);
  return [...s].map((x) => x.trim()).filter(Boolean); // the sync iterator flushes the rest
}

/** Cuts one sentence into pieces of at most `limit` characters, preferring clause breaks. */
function cut(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence];
  const clauses = sentence.split(/(?<=[,;:—–])\s+/);
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const c of clauses) {
    if (c.length > limit) {
      flush();
      // no clause break: cut at a space near the limit
      let rest = c;
      while (rest.length > limit) {
        const at = rest.lastIndexOf(' ', limit);
        const i = at > limit / 2 ? at : limit;
        out.push(rest.slice(0, i).trim());
        rest = rest.slice(i).trim();
      }
      cur = rest;
    } else if (!cur) {
      cur = c;
    } else if (cur.length + 1 + c.length <= limit) {
      cur += ` ${c}`;
    } else {
      flush();
      cur = c;
    }
  }
  flush();
  return out;
}

export function speechChunks(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    if (out.length === 0) {
      const [first, ...rest] = cut(s, FIRST_CHUNK_CHARS);
      out.push(first);
      // the remainder of the first sentence can use the normal size
      if (rest.length) out.push(...cut(rest.join(' '), CHUNK_CHARS));
    } else {
      out.push(...cut(s, CHUNK_CHARS));
    }
  }
  return out;
}
