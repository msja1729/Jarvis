/**
 * "What did they just say?": a rolling, private text of what the computer played (listen-along) or what
 * was said in a meeting being recorded, for the last few minutes.
 *
 * Sound arrives as 16 kHz mono PCM, is cut into short pieces and transcribed on this computer. Only text
 * is kept, only in memory, and only for the last 15 minutes; audio pieces are deleted right after. When
 * someone asks, the words still waiting in the current piece are transcribed first, so the answer covers
 * what was said a moment ago.
 */
import { SAMPLE_RATE } from './pcm.js';
import { dropFiller, pcmLevel, SILENCE_LEVEL } from './hallucination.js';

export const PIECE_SECONDS = 15;
export const KEEP_MS = 15 * 60_000;

export interface Line {
  at: number;
  text: string;
}

export class RecentAudio {
  private lines: Line[] = [];
  private buf: Buffer[] = [];
  private bytes = 0;
  private startedAt = 0;
  private queue: Promise<void> = Promise.resolve();
  /** Bumped by clear(): pieces still being transcribed then are thrown away. */
  private generation = 0;

  constructor(
    /** Turns 16 kHz mono PCM into text (on this computer). */
    private readonly transcribe: (pcm: Uint8Array) => Promise<string>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get hasText(): boolean {
    return this.lines.length > 0;
  }

  push(pcm: Uint8Array): void {
    if (!pcm.length) return;
    if (!this.bytes) this.startedAt = this.now();
    this.buf.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2)));
    this.bytes += pcm.byteLength;
    if (this.bytes >= PIECE_SECONDS * SAMPLE_RATE * 2) this.cut();
  }

  /** Sends what is buffered to be transcribed (in order). */
  private cut(): void {
    if (!this.bytes) return;
    const pcm = new Uint8Array(Buffer.concat(this.buf));
    const at = this.startedAt;
    this.buf = [];
    this.bytes = 0;
    if (pcm.length < SAMPLE_RATE || pcmLevel(pcm) < SILENCE_LEVEL) return; // under half a second, or silence
    const gen = this.generation;
    this.queue = this.queue.then(async () => {
      if (gen !== this.generation) return;
      try {
        const text = dropFiller((await this.transcribe(pcm)).replace(/\s+/g, ' ').trim());
        if (text && gen === this.generation) this.lines.push({ at, text });
      } catch {
        /* a piece that could not be transcribed is skipped */
      }
      this.prune();
    });
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_MS;
    this.lines = this.lines.filter((l) => l.at >= cutoff);
  }

  /** The text of the last `minutes`, with clock times; transcribes what is still waiting first. */
  async recent(minutes: number): Promise<string> {
    this.cut();
    await this.queue;
    this.prune();
    const from = this.now() - Math.max(1, Math.min(15, minutes)) * 60_000;
    const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);
    return this.lines
      .filter((l) => l.at >= from - PIECE_SECONDS * 1000)
      .map((l) => `[${clock(l.at)}] ${l.text}`)
      .join('\n');
  }

  /** Forgets everything (listen-along stopped). */
  clear(): void {
    this.generation++;
    this.lines = [];
    this.buf = [];
    this.bytes = 0;
  }
}
