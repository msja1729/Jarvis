/**
 * Whisper "hears" stock phrases in silence or noise ("Thank you.", "Thanks for watching!", "you").
 * For meetings: silent pieces are not transcribed at all, and a piece whose whole text is only such
 * phrases is dropped, so an empty or noisy recording gives an empty transcript, not filler.
 */

/** Loudness (RMS, 0..1) of Int16 little-endian PCM. */
export function pcmLevel(pcm: Uint8Array): number {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = v.getInt16(i * 2, true) / 32768;
    sum += x * x;
  }
  return Math.sqrt(sum / n);
}

/** Below this the piece is silence (about -54 dBFS: a quiet room, no one talking). */
export const SILENCE_LEVEL = 0.002;

const FILLER =
  /^(thank you( (very|so) much)?( for (watching|listening))?|thanks( for (watching|listening))?|you|bye|okay|ok|hmm+|um+|uh+|so|subtitles? by .*|please subscribe.*|\[?(music|silence|blank_audio|no speech|inaudible)\]?|\(\s*(music|silence|inaudible)\s*\))$/i;

/** The text without Whisper's filler; '' when nothing real was said. */
export function dropFiller(text: string): string {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const real = parts.filter((p) => {
    const core = p.replace(/♪/g, ' ').replace(/[.!?,…\s]+$/g, '').trim();
    return core !== '' && !FILLER.test(core);
  });
  return real.length ? text.trim() : '';
}
