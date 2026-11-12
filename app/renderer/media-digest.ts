/**
 * Runs in a hidden, muted window: opens a video (or audio) file the user shared and turns it into what an
 * expert can take in: a picture each time the scene changes (like the meeting slides) and the sound as
 * 16 kHz mono PCM, which the main process transcribes on this computer. Nothing leaves the computer.
 */
import { ChangeDetector, THUMB_H, THUMB_W, toGrey } from '../../speech/screen-diff.js';
import { floatTo16 } from '../../speech/pcm.js';

const api = (window as unknown as { jarvis: { digestDone(r: unknown): void } }).jarvis;

/** At most this much of a long video is taken in (a summary of the rest would need another pass). */
export const MAX_SECONDS = 40 * 60;
const MAX_PICTURES = 12;
const MAX_SIDE = 1280;

async function frames(url: string): Promise<{ duration: number; pictures: { at: number; jpeg: Uint8Array }[]; hasVideo: boolean }> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((ok, fail) => {
    v.onloadedmetadata = () => ok();
    v.onerror = () => fail(new Error('this video format could not be opened'));
  });
  const duration = Number.isFinite(v.duration) ? v.duration : 0;
  if (!v.videoWidth) return { duration, pictures: [], hasVideo: false };
  const thumb = document.createElement('canvas');
  thumb.width = THUMB_W;
  thumb.height = THUMB_H;
  const tg = thumb.getContext('2d', { willReadFrequently: true })!;
  const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const big = document.createElement('canvas');
  big.width = Math.round(v.videoWidth * scale);
  big.height = Math.round(v.videoHeight * scale);
  const bg = big.getContext('2d')!;
  const span = Math.min(duration, MAX_SECONDS);
  const step = Math.max(2, span / 300); // at most ~300 looks, however long the video
  const detector = new ChangeDetector({ minGapMs: Math.max(5000, (span * 1000) / MAX_PICTURES / 2), max: MAX_PICTURES });
  const pictures: { at: number; jpeg: Uint8Array }[] = [];
  for (let t = 0.5; t < Math.max(span, 1); t += step) {
    v.currentTime = Math.min(t, Math.max(0, duration - 0.1));
    await new Promise<void>((ok) => {
      v.onseeked = () => ok();
      setTimeout(ok, 3000);
    });
    tg.drawImage(v, 0, 0, THUMB_W, THUMB_H);
    if (!detector.sample(toGrey(tg.getImageData(0, 0, THUMB_W, THUMB_H).data), t * 1000)) continue;
    bg.drawImage(v, 0, 0, big.width, big.height);
    const blob = await new Promise<Blob | null>((r) => big.toBlob(r, 'image/jpeg', 0.85));
    if (blob) pictures.push({ at: Math.round(t), jpeg: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { duration, pictures, hasVideo: true };
}

/** The sound, as 16 kHz mono Int16 PCM (the first MAX_SECONDS). */
async function sound(url: string): Promise<Uint8Array | null> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(data);
    void ctx.close();
    const seconds = Math.min(decoded.duration, MAX_SECONDS);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0, 0, seconds);
    const out = await off.startRendering();
    return floatTo16(out.getChannelData(0));
  } catch {
    return null; // no sound track, or a format Chromium cannot decode
  }
}

(async () => {
  const file = new URLSearchParams(location.search).get('file') ?? '';
  const url = `file:///${file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;
  try {
    const f = await frames(url).catch(() => ({ duration: 0, pictures: [], hasVideo: false }));
    const pcm = await sound(url);
    api.digestDone({ ok: true, duration: f.duration, hasVideo: f.hasVideo, pictures: f.pictures, pcm, cut: f.duration > MAX_SECONDS });
  } catch (err) {
    api.digestDone({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
