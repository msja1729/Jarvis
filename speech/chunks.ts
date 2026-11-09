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

/** The second piece is kept medium-sized so it is ready before the first one finishes playing. */
export const SECOND_CHUNK_CHARS = 140;
/** Pieces shorter than this are joined with the next (a lone "Sure!" plays too fast to cover the next piece). */
export const MIN_CHUNK_CHARS = 28;

export function speechChunks(text: string): string[] {
  // tiny sentences ride along with the next one
  const merged: string[] = [];
  for (const s of sentences(text)) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length < MIN_CHUNK_CHARS && prev.length + 1 + s.length <= CHUNK_CHARS) merged[merged.length - 1] = `${prev} ${s}`;
    else merged.push(s);
  }
  const out: string[] = [];
  for (const s of merged) {
    // growing sizes: start fast, then keep ahead of playback
    const limit = out.length === 0 ? FIRST_CHUNK_CHARS : out.length === 1 ? SECOND_CHUNK_CHARS : CHUNK_CHARS;
    const [first, ...rest] = cut(s, limit);
    out.push(first);
    if (rest.length) out.push(...cut(rest.join(' '), out.length === 1 ? SECOND_CHUNK_CHARS : CHUNK_CHARS));
  }
  return out;
}

/** Pause after a piece, by how it ends: a full stop is a breath, a comma is a beat, a cut mid-phrase is none. */
export function pauseAfter(piece: string): number {
  const end = piece.trim().slice(-1);
  if ('.!?…'.includes(end)) return 0.28;
  if (':;'.includes(end)) return 0.18;
  if (',—–-'.includes(end)) return 0.09;
  return 0.02;
}

/**
 * The voice model pads every piece with 0.2-0.8 s of silence at both ends, which sounded like the
 * voice breaking mid-sentence. Trim it (keeping a few ms so nothing clicks) and add the right pause.
 */
export function tidyPiece(audio: Float32Array, rate: number, pause: number): Float32Array {
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return new Float32Array(Math.round(rate * pause));
  const th = peak * 0.015;
  let first = 0;
  while (first < audio.length && Math.abs(audio[first]) < th) first++;
  let last = audio.length - 1;
  while (last > first && Math.abs(audio[last]) < th) last--;
  const keep = Math.round(rate * 0.025); // keep 25 ms of the natural attack and release
  const from = Math.max(0, first - keep);
  const to = Math.min(audio.length, last + 1 + keep * 2);
  const out = new Float32Array(to - from + Math.round(rate * pause));
  out.set(audio.subarray(from, to));
  // short fades so cut edges never click
  const fade = Math.min(Math.round(rate * 0.006), (to - from) >> 2);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[to - from - 1 - i] *= i / fade;
  }
  return out;
}
