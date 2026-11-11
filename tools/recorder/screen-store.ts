/**
 * Where a meeting's screen recording goes: one folder per meeting in the user's Videos folder
 * (Videos/Jarvis Meetings/<date time>/) with the video file (screen + microphone + computer sound)
 * and a Screens folder of pictures taken whenever the screen changed. An index next to the
 * transcript lets the team find the pictures and their times.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ScreenIndex {
  id: string;
  folder: string;
  video: string | null;
  frames: { file: string; at: number }[];
}

export const indexPath = (transcripts: string, id: string) => path.join(transcripts, `${id}.screens.json`);

export function readIndex(transcripts: string, id: string): ScreenIndex | null {
  try {
    return JSON.parse(fs.readFileSync(indexPath(transcripts, id), 'utf8')) as ScreenIndex;
  } catch {
    return null;
  }
}

const clockName = (sec: number) => {
  const s = Math.floor(sec);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}-` : ''}${p(Math.floor((s % 3600) / 60))}-${p(s % 60)}`;
};

export class ScreenStore {
  private index: ScreenIndex | null = null;
  private out: fs.WriteStream | null = null;
  private failed = false;

  constructor(
    /** Videos/Jarvis Meetings */
    private readonly root: string,
    /** Jarvis's transcripts folder (the index goes there). */
    private readonly transcripts: string,
  ) {}

  get active(): boolean {
    return this.index !== null;
  }

  start(id: string): void {
    const folder = path.join(this.root, id.replace('_', ' '));
    fs.mkdirSync(path.join(folder, 'Screens'), { recursive: true });
    this.index = { id, folder, video: null, frames: [] };
    this.out = null;
    this.failed = false;
  }

  video(chunk: Uint8Array, mimeType: string): void {
    const ix = this.index;
    if (!ix || this.failed) return;
    if (!this.out) {
      ix.video = path.join(ix.folder, `Meeting.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
      this.out = fs.createWriteStream(ix.video);
      this.out.on('error', () => (this.failed = true));
    }
    this.out.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }

  /** A picture of the screen, `atSec` seconds into the meeting. Returns its number (1, 2, …). */
  frame(jpeg: Uint8Array, atSec: number): number {
    const ix = this.index;
    if (!ix) return 0;
    const n = ix.frames.length + 1;
    const file = `${String(n).padStart(3, '0')} at ${clockName(atSec)}.jpg`;
    fs.writeFileSync(path.join(ix.folder, 'Screens', file), Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength));
    ix.frames.push({ file, at: Math.round(atSec) });
    return n;
  }

  /** Closes the video file and writes the index. */
  async stop(): Promise<ScreenIndex | null> {
    const ix = this.index;
    this.index = null;
    if (!ix) return null;
    const out = this.out;
    this.out = null;
    if (out) await new Promise<void>((r) => out.end(() => r()));
    if (ix.video && (!fs.existsSync(ix.video) || fs.statSync(ix.video).size === 0)) ix.video = null;
    fs.mkdirSync(this.transcripts, { recursive: true });
    fs.writeFileSync(indexPath(this.transcripts, ix.id), JSON.stringify(ix, null, 1));
    return ix;
  }
}
