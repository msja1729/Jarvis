/**
 * Natural local voice (Kokoro-82M) for spoken replies. T8: speech never goes
 * through Claude; the text is turned into audio on this computer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { downloadVerified } from './download.js';
import { KOKORO_FILES, KOKORO_REPO, kokoroUrl } from './kokoro-files.js';
import { cleanForSpeech } from './speakable.js';

export interface KokoroStatus {
  installed: boolean;
  ready: boolean;
  downloadBytes: number;
}

export interface ChunkSink {
  (chunk: { id: number; index: number; rate: number; audio: Float32Array; words?: number; pause?: number }): void;
}

type Pending = { onChunk: ChunkSink; resolve: (r: { cancelled: boolean; error?: string }) => void };

export class KokoroEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private installing: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly dir: string,
    private readonly workerPath: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Where transformers.js finds the model: <dir>/<repo>/<file>. */
  get modelDir(): string {
    return this.dir;
  }

  private filePath(file: string) {
    return path.join(this.dir, KOKORO_REPO, ...file.split('/'));
  }

  status(): KokoroStatus {
    const installed = KOKORO_FILES.every((f) => {
      try {
        return fs.statSync(this.filePath(f.path)).size === f.bytes;
      } catch {
        return false;
      }
    });
    return { installed, ready: installed, downloadBytes: KOKORO_FILES.reduce((s, f) => s + f.bytes, 0) };
  }

  /** An earlier voice model is on disk (the user installed the voice before an update). */
  hasOlderModel(): boolean {
    const keep = new Set(KOKORO_FILES.map((f) => path.resolve(this.filePath(f.path))));
    const dir = path.join(this.dir, KOKORO_REPO, 'onnx');
    try {
      return fs.readdirSync(dir).some((f) => f.endsWith('.onnx') && !keep.has(path.resolve(dir, f)));
    } catch {
      return false;
    }
  }

  install(progress: (label: string, fraction: number) => void = () => undefined): Promise<void> {
    this.installing ??= (async () => {
      const total = KOKORO_FILES.reduce((s, f) => s + f.bytes, 0);
      let done = 0;
      for (const f of KOKORO_FILES) {
        const dest = this.filePath(f.path);
        const ok = fs.existsSync(dest) && fs.statSync(dest).size === f.bytes;
        if (!ok) {
          await downloadVerified(this.fetchImpl, kokoroUrl(f.path), dest, f.sha256, (frac) =>
            progress('Downloading natural voice', (done + frac * f.bytes) / total),
          );
        }
        done += f.bytes;
        progress('Downloading natural voice', done / total);
      }
      this.removeOldFiles();
    })().finally(() => (this.installing = null));
    return this.installing;
  }

  /**
   * After a successful install, delete anything in the voice folder that the
   * current model does not use (an older model version, half-finished downloads),
   * so upgrading the voice never leaves the old one taking up space.
   */
  removeOldFiles(): void {
    const keep = new Set(KOKORO_FILES.map((f) => path.resolve(this.filePath(f.path))));
    const sweep = (dir: string): boolean => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      let empty = true;
      for (const e of entries) {
        const p = path.resolve(dir, e.name);
        if (e.isDirectory()) {
          if (sweep(p)) fs.rmSync(p, { recursive: true, force: true });
          else empty = false;
        } else if (keep.has(p)) {
          empty = false;
        } else {
          fs.rmSync(p, { force: true });
        }
      }
      return empty;
    };
    sweep(path.resolve(this.dir));
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const w = new Worker(this.workerPath);
    this.worker = w;
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (m: { type: string; message?: string }) => {
        if (m.type === 'ready') resolve();
        else if (m.type === 'error') reject(new Error(m.message));
      };
      w.on('message', onReady);
      w.once('error', reject);
      w.postMessage({ type: 'init', modelDir: this.dir, repo: KOKORO_REPO });
    });
    w.on('message', (m: { type: string; id: number; index: number; rate: number; audio: Float32Array; words?: number; pause?: number; cancelled?: boolean; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'chunk') p.onChunk({ id: m.id, index: m.index, rate: m.rate, audio: m.audio, words: m.words, pause: m.pause });
      if (m.type === 'done') {
        this.pending.delete(m.id);
        p.resolve({ cancelled: Boolean(m.cancelled), error: m.error });
      }
    });
    w.on('exit', () => {
      this.worker = null;
      this.ready = null;
      for (const p of this.pending.values()) p.resolve({ cancelled: true, error: 'voice engine stopped' });
      this.pending.clear();
    });
    this.ready.catch(() => {
      this.ready = null;
      void w.terminate();
    });
    return this.ready;
  }

  /** Loads the model in the background so the first reply speaks quickly. */
  warmUp(): void {
    if (this.status().installed) void this.start().catch(() => undefined);
  }

  /**
   * Speaks `text` (cleaned for speech) sentence by sentence. Returns an id at once;
   * `done` resolves when all chunks were sent or the request was cancelled.
   */
  speak(text: string, voice: string, speed: number, onChunk: ChunkSink): { id: number; done: Promise<{ cancelled: boolean; error?: string }> } {
    const id = this.nextId++;
    const spoken = cleanForSpeech(text);
    const done = new Promise<{ cancelled: boolean; error?: string }>((resolve) => {
      if (!spoken) return resolve({ cancelled: false });
      this.pending.set(id, { onChunk, resolve });
      this.start()
        .then(() => this.worker!.postMessage({ type: 'speak', id, text: spoken, voice, speed }))
        .catch((err) => {
          this.pending.delete(id);
          resolve({ cancelled: false, error: String(err) });
        });
    });
    return { id, done };
  }

  cancel(id?: number): void {
    const ids = id === undefined ? [...this.pending.keys()] : [id];
    for (const i of ids) this.worker?.postMessage({ type: 'cancel', id: i });
  }

  dispose(): void {
    void this.worker?.terminate();
  }
}
