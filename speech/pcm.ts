/**
 * 16 kHz mono 16-bit PCM helpers, shared by the renderer (capture) and main
 * (WAV files for whisper.cpp). Pure functions, no Node or DOM APIs.
 */
export const SAMPLE_RATE = 16000;

/** Float32 [-1, 1] samples → little-endian Int16 bytes. */
export function floatTo16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Root-mean-square level of Float32 samples (0..1). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** 44-byte WAV header for 16-bit PCM. */
export function wavHeader(dataBytes: number, sampleRate = SAMPLE_RATE, channels = 1): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

export function bytesToSeconds(bytes: number, sampleRate = SAMPLE_RATE): number {
  return bytes / 2 / sampleRate;
}

/**
 * Gets push-to-talk audio ready for speech recognition (16 kHz mono 16-bit):
 * - trims the silence before and after you speak (keeps a little padding), so the
 *   engine has less to process and fewer chances to imagine words in the quiet;
 * - evens out the volume: soft, distant or mumbled speech is raised (up to 8×) so
 *   its loudest part is at about 90%, without clipping.
 */
export function prepareSpeech(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return pcm;
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const frame = Math.round(sampleRate * 0.02); // 20 ms
  const frames = Math.ceil(n / frame);
  const level: number[] = [];
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const end = Math.min(n, (f + 1) * frame);
    for (let i = f * frame; i < end; i++) {
      const s = view.getInt16(i * 2, true) / 32768;
      sum += s * s;
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
    level.push(Math.sqrt(sum / Math.max(1, end - f * frame)));
  }
  // speech = frames clearly above the quietest part of the recording (the room's own noise)
  const sorted = [...level].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const loudest = sorted[sorted.length - 1] ?? 0;
  const threshold = Math.max(floor * 2.5, loudest * 0.08, 0.004);
  let first = level.findIndex((l) => l > threshold);
  let last = level.length - 1 - [...level].reverse().findIndex((l) => l > threshold);
  if (first < 0) return pcm; // nothing that sounds like speech: leave it as it is
  const pad = Math.round(0.25 / 0.02); // keep 250 ms around the words
  first = Math.max(0, first - pad);
  last = Math.min(frames - 1, last + pad);
  const start = first * frame;
  const stop = Math.min(n, (last + 1) * frame);
  const gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
  const out = new Uint8Array((stop - start) * 2);
  const ov = new DataView(out.buffer);
  for (let i = start; i < stop; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.round(view.getInt16(i * 2, true) * gain)));
    ov.setInt16((i - start) * 2, s, true);
  }
  return out;
}

/**
 * Long speech is turned into text in pieces: the speech engine skips sentences in recordings much
 * longer than 30 seconds. Each piece is at most maxSec long and ends at the quietest moment between
 * minSec and maxSec (a pause between words), so no word is cut in two.
 */
export function splitAtPauses(pcm: Uint8Array, maxSec = 25, minSec = 12, sampleRate = SAMPLE_RATE): Uint8Array[] {
  const bytesPerSec = sampleRate * 2;
  const frame = Math.round(sampleRate * 0.1) * 2; // 100 ms
  const pieces: Uint8Array[] = [];
  let start = 0;
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  const energy = (at: number) => {
    let sum = 0;
    const end = Math.min(at + frame, v.byteLength);
    for (let i = at; i + 1 < end; i += 2) {
      const x = v.getInt16(i, true);
      sum += x * x;
    }
    return sum;
  };
  while (pcm.length - start > maxSec * bytesPerSec) {
    let best = start + maxSec * bytesPerSec;
    let bestE = Infinity;
    for (let at = start + minSec * bytesPerSec; at + frame <= start + maxSec * bytesPerSec; at += frame) {
      const e = energy(at);
      if (e < bestE) {
        bestE = e;
        best = at + frame / 2 - ((at + frame / 2) % 2);
      }
    }
    pieces.push(pcm.subarray(start, best));
    start = best;
  }
  pieces.push(pcm.subarray(start));
  return pieces.filter((p) => p.length > 0);
}

/** The sound data of a WAV file (after its "data" header). */
export function wavData(wav: Uint8Array): Uint8Array {
  for (let i = 12; i + 8 <= wav.length && i < 4096; ) {
    const id = String.fromCharCode(wav[i], wav[i + 1], wav[i + 2], wav[i + 3]);
    const size = wav[i + 4] | (wav[i + 5] << 8) | (wav[i + 6] << 16) | (wav[i + 7] << 24);
    if (id === 'data') return wav.subarray(i + 8, Math.min(wav.length, i + 8 + (size >>> 0)));
    i += 8 + size + (size % 2);
  }
  return wav.subarray(44);
}
