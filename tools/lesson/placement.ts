/**
 * Where to open a lesson: on an empty side of the screen, so the user can keep
 * watching what they were looking at, or full screen when there is no room.
 * Works on a tiny grey-scale picture of the screen, on this computer; nothing is sent anywhere.
 */
export type Side = 'left' | 'right' | 'full';

/** Share of the screen width the lesson takes when it opens at the side. */
export const SIDE_FRACTION = 0.42;
/** A side counts as empty when fewer than this share of its pixels are edges (text, lines, pictures). */
export const EMPTY_EDGE_DENSITY = 0.035;

export interface SideScores {
  left: number;
  right: number;
  choice: Side;
}

/** Share of "edge" pixels (sharp brightness changes) inside columns [x0, x1). */
function edgeDensity(gray: Uint8Array, w: number, h: number, x0: number, x1: number): number {
  let edges = 0;
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const i = y * w + x;
      const g = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + w] - gray[i - w]);
      if (g > 40) edges++;
      total++;
    }
  }
  return total ? edges / total : 1;
}

export function chooseSide(gray: Uint8Array, w: number, h: number): SideScores {
  const band = Math.round(w * SIDE_FRACTION);
  const left = edgeDensity(gray, w, h, 0, band);
  const right = edgeDensity(gray, w, h, w - band, w);
  // Prefer the right side when both are equally empty: that is where people expect a side panel.
  const best: Side = right <= left * 1.15 ? 'right' : 'left';
  const score = best === 'right' ? right : left;
  return { left, right, choice: score <= EMPTY_EDGE_DENSITY ? best : 'full' };
}

/** BGRA (Electron's NativeImage.toBitmap) to grey-scale. */
export function bgraToGray(bgra: Uint8Array | Buffer, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (bgra[p] * 29 + bgra[p + 1] * 150 + bgra[p + 2] * 77) >> 8;
  return out;
}
