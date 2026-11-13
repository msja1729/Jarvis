import { describe, expect, it } from 'vitest';
import { splitAtPauses, wavData, wavHeader, SAMPLE_RATE } from '../speech/pcm.js';

/** Speech-like sound (loud) with a quiet gap at each of the given seconds. */
function speech(seconds: number, pausesAt: number[]): Uint8Array {
  const n = seconds * SAMPLE_RATE;
  const out = new Uint8Array(n * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const quiet = pausesAt.some((p) => t >= p && t < p + 0.4);
    v.setInt16(i * 2, quiet ? 0 : Math.round(8000 * Math.sin(i / 7)), true);
  }
  return out;
}

describe('long speech is turned into text in pieces', () => {
  it('short speech stays in one piece', () => {
    expect(splitAtPauses(speech(20, []))).toHaveLength(1);
  });

  it('a long explanation is cut only at pauses, into pieces under 30 seconds, and nothing is lost', () => {
    const pcm = speech(70, [18, 33, 47, 61]);
    const pieces = splitAtPauses(pcm);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) expect(p.length / 2 / SAMPLE_RATE).toBeLessThanOrEqual(25.01);
    expect(pieces.reduce((s, p) => s + p.length, 0)).toBe(pcm.length);
    // every cut falls inside a pause
    let at = 0;
    for (const p of pieces.slice(0, -1)) {
      at += p.length / 2 / SAMPLE_RATE;
      expect([18, 33, 47, 61].some((q) => at >= q && at <= q + 0.4)).toBe(true);
    }
  });

  it('reads the sound out of a WAV file', () => {
    const pcm = speech(1, []);
    const wav = new Uint8Array([...wavHeader(pcm.length), ...pcm]);
    expect(wavData(wav)).toEqual(pcm);
  });
});
