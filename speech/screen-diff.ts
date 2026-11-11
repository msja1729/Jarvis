/**
 * Deciding when the screen shows something new worth a picture: a new slide, a page scrolled,
 * writing on a board. The screen is sampled as a tiny greyscale thumbnail; a picture is taken when
 * it differs enough from the last picture AND has held still for a moment (so a playing video or an
 * animation is not photographed frame by frame, and slides are caught after their transition ends).
 */
export const THUMB_W = 64;
export const THUMB_H = 36;
/** Average brightness change (0-255) that counts as "different". */
export const CHANGE = 6;
/** Below this the screen is "holding still". */
export const STILL = 2.5;

/** RGBA pixels → greyscale bytes. */
export function toGrey(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}

/** Mean absolute difference between two greyscale thumbnails. */
export function difference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || !a.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface ChangeDetectorOptions {
  /** Shortest time between two pictures. */
  minGapMs?: number;
  /** Most pictures per recording. */
  max?: number;
}

/** Feed it a thumbnail every couple of seconds; it says when to take a picture. */
export class ChangeDetector {
  private lastShot: Uint8Array | null = null;
  private prev: Uint8Array | null = null;
  private lastShotAt = -Infinity;
  count = 0;

  constructor(private readonly opts: ChangeDetectorOptions = {}) {}

  /** True when a picture should be taken now. The first sample is always taken. */
  sample(thumb: Uint8Array, nowMs: number): boolean {
    const prev = this.prev;
    this.prev = thumb;
    if (this.count >= (this.opts.max ?? 300)) return false;
    if (!this.lastShot) return this.take(thumb, nowMs);
    if (nowMs - this.lastShotAt < (this.opts.minGapMs ?? 8000)) return false;
    const changed = difference(thumb, this.lastShot) >= CHANGE;
    const still = prev !== null && difference(thumb, prev) <= STILL;
    return changed && still ? this.take(thumb, nowMs) : false;
  }

  private take(thumb: Uint8Array, nowMs: number): boolean {
    this.lastShot = thumb;
    this.lastShotAt = nowMs;
    this.count++;
    return true;
  }
}
