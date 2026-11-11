/**
 * Meeting recorder (SPEC 6.6, criterion 22).
 * Receives 16 kHz mono PCM from the renderer, cuts it into 30-second WAV segments,
 * transcribes each one locally while the meeting goes on, and on stop writes one
 * transcript file. Audio segments are deleted once transcribed; only text is kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bytesToSeconds, SAMPLE_RATE, wavHeader } from '../../speech/pcm.js';

export const SEGMENT_SECONDS = 30;
const SEGMENT_BYTES = SEGMENT_SECONDS * SAMPLE_RATE * 2;

export type Transcriber = (wavPath: string) => Promise<string>;

export interface RecordingResult {
  id: string;
  transcriptPath: string;
  text: string;
  seconds: number;
  failedSegments: number;
}

interface Segment {
  index: number;
  startSec: number;
  wav: string;
  text?: string;
  error?: string;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function clock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

export class MeetingRecorder {
  private id: string | null = null;
  private workDir = '';
  private started = 0;
  private buffer: Buffer[] = [];
  private bufferBytes = 0;
  private totalBytes = 0;
  private segments: Segment[] = [];
  private queue: Promise<void> = Promise.resolve();
  /** Things that happened on screen, by time ("picture 3 of the screen"). */
  private notes: { at: number; text: string }[] = [];

  constructor(
    private readonly dirs: { work: string; transcripts: string },
    private readonly transcribe: Transcriber,
    private readonly now: () => Date = () => new Date(),
    /** Called with (done, total) as segments finish. */
    private readonly onProgress: (done: number, total: number) => void = () => undefined,
  ) {}

  get recording(): boolean {
    return this.id !== null;
  }

  get elapsedSeconds(): number {
    return bytesToSeconds(this.totalBytes);
  }

  start(): string {
    if (this.id) throw new Error('Already recording.');
    const d = this.now();
    this.id = stamp(d);
    this.started = d.getTime();
    this.workDir = path.join(this.dirs.work, this.id);
    fs.mkdirSync(this.workDir, { recursive: true });
    this.buffer = [];
    this.bufferBytes = 0;
    this.totalBytes = 0;
    this.segments = [];
    this.notes = [];
    this.queue = Promise.resolve();
    return this.id;
  }

  /** Abandons a recording that never got going (nothing is written). */
  cancel(): void {
    if (!this.id) return;
    this.id = null;
    fs.rmSync(this.workDir, { recursive: true, force: true });
  }

  /** Notes something at the current point of the recording (shown in the transcript at that time). */
  note(text: string): void {
    if (this.id) this.notes.push({ at: this.elapsedSeconds, text });
  }

  /** Append PCM (Int16 LE, 16 kHz mono). Full 30-second segments are queued for transcription. */
  push(pcm: Uint8Array): void {
    if (!this.id || pcm.length === 0) return;
    const chunk = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
    this.totalBytes += chunk.length;
    while (this.bufferBytes >= SEGMENT_BYTES) this.cut(SEGMENT_BYTES);
  }

  private cut(bytes: number) {
    const all = Buffer.concat(this.buffer);
    const data = all.subarray(0, bytes);
    const rest = all.subarray(bytes);
    this.buffer = rest.length ? [Buffer.from(rest)] : [];
    this.bufferBytes = rest.length;
    const index = this.segments.length;
    const seg: Segment = {
      index,
      startSec: bytesToSeconds(this.totalBytes - this.bufferBytes - data.length),
      wav: path.join(this.workDir, `seg-${String(index).padStart(4, '0')}.wav`),
    };
    fs.writeFileSync(seg.wav, Buffer.concat([Buffer.from(wavHeader(data.length)), data]));
    this.segments.push(seg);
    this.queue = this.queue.then(async () => {
      try {
        seg.text = await this.transcribe(seg.wav);
      } catch (err) {
        seg.error = err instanceof Error ? err.message : String(err);
      } finally {
        if (!seg.error) fs.rmSync(seg.wav, { force: true });
        this.onProgress(this.segments.filter((s) => s.text !== undefined || s.error).length, this.segments.length);
      }
    });
  }

  /** Stops, waits for all segments, writes the transcript file. `video`: where the screen recording was saved, if any. */
  async stop(video?: string | null): Promise<RecordingResult> {
    if (!this.id) throw new Error('Not recording.');
    if (this.bufferBytes >= SAMPLE_RATE) this.cut(this.bufferBytes); // keep tails of 0.5 s or more
    const id = this.id;
    const seconds = this.elapsedSeconds;
    this.id = null;
    await this.queue;

    const lines = [
      ...this.segments.filter((s) => s.text).map((s) => ({ at: s.startSec, line: `[${clock(s.startSec)}] ${s.text}` })),
      ...this.notes.map((n) => ({ at: n.at, line: `[${clock(n.at)}] (${n.text})` })),
    ]
      .sort((a, b) => a.at - b.at)
      .map((x) => x.line);
    const failed = this.segments.filter((s) => s.error).length;
    const header =
      `Meeting transcript — ${new Date(this.started).toLocaleString()} — ${clock(seconds)} long\n` +
      `(Transcribed on this computer. ${video ? `Video with sound: ${video}` : 'Audio is not kept.'}${failed ? ` ${failed} part(s) could not be transcribed.` : ''})\n\n`;
    // pictures alone are not "speech": with no words, say so (the pictures are still listed in the index)
    const text = this.segments.some((s) => s.text) ? lines.join('\n') : '';
    fs.mkdirSync(this.dirs.transcripts, { recursive: true });
    const transcriptPath = path.join(this.dirs.transcripts, `${id}.txt`);
    fs.writeFileSync(transcriptPath, header + (text || '(No speech was detected.)') + '\n');
    if (!failed) fs.rmSync(this.workDir, { recursive: true, force: true });
    return { id, transcriptPath, text, seconds, failedSegments: failed };
  }
}
