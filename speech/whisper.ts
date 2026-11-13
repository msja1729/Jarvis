/**
 * Local speech-to-text with whisper.cpp (T8: audio never leaves this computer).
 *
 * Model: Whisper large-v3-turbo (5-bit), held to English. It understands fast, casual
 * speech and many accents far better than the old base.en model.
 *
 * Engine (Windows), picked for the computer, downloaded once and checked against its SHA-256:
 *  - NVIDIA graphics card: the CUDA 12 build. A sentence takes about a quarter of a second.
 *  - otherwise: the CPU (OpenBLAS) build. Slower (several seconds per sentence) but works anywhere.
 * macOS: `whisper-cli` from Homebrew (`brew install whisper-cpp`), which uses the GPU (Metal) itself.
 *
 * Speed: the model stays loaded in a background whisper-server that only listens on this
 * computer (127.0.0.1), so each sentence skips loading 570 MB. If the server is not running
 * or fails, whisper-cli is used for that request instead.
 *
 * This module starts whisper only. It never starts `claude` (criterion 7).
 */
import { ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { downloadVerified } from './download.js';
import { splitAtPauses, wavData, wavHeader } from './pcm.js';

export const ENGINE_VERSION = 'b5454';

export interface EngineBuild {
  kind: 'gpu' | 'cpu';
  url: string;
  sha256: string;
  bytes: number;
}

/** Official whisper.cpp release builds for Windows x64 (b5454, October 2026). */
export const WHISPER_BUILDS: Record<'gpu' | 'cpu', EngineBuild> = {
  gpu: {
    kind: 'gpu',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${ENGINE_VERSION}/whisper-bin-win-cuda-12.4.0-x64.zip`,
    sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a',
    bytes: 684913404,
  },
  cpu: {
    kind: 'cpu',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${ENGINE_VERSION}/whisper-blas-bin-x64.zip`,
    sha256: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3',
    bytes: 21715607,
  },
};

/** Pinned to one revision of the whisper.cpp model repository. */
export const WHISPER_MODEL = {
  name: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  bytes: 574041195,
};

/** Files from older versions, removed after an upgrade. */
const OLD_FILES = [path.join('models', 'ggml-base.en.bin'), 'whisper'];

/** Programs in the release we never run (demos and tests); deleted after unpacking to save space. */
const KEEP_EXE = new Set(['whisper-cli.exe', 'whisper-server.exe']);

export const MAC_HELP = 'On macOS, install the speech engine once in Terminal:  brew install whisper-cpp  (then click "Check again").';

export interface SpeechStatus {
  engine: boolean;
  model: boolean;
  ready: boolean;
  /** Which engine this computer uses. */
  device: 'gpu' | 'cpu' | 'mac';
  /** What still has to be downloaded, in bytes. */
  downloadBytes: number;
  /** Shown when the engine cannot be downloaded automatically. */
  help?: string;
}

export type Progress = (label: string, fraction: number) => void;

/** True when an NVIDIA driver is installed (its CUDA driver library is in System32). Checked without starting anything. */
export function hasNvidiaGpu(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvcuda.dll');
  return fs.existsSync(sys);
}

export class WhisperEngine {
  /** Words to expect (the team's and the user's names), passed to whisper as its starting prompt. */
  vocabulary = '';
  /** Extra whisper-cli options (for tuning). */
  extraArgs: string[] = [];

  private installing: Promise<void> | null = null;
  private server: { proc: ChildProcess | null; url: string; ready: Promise<boolean> } | null = null;

  constructor(
    private readonly dir: string,
    private readonly opts: {
      platform?: NodeJS.Platform;
      fetchImpl?: typeof fetch;
      binaryOverride?: string;
      modelOverride?: string;
      /** Force the GPU or CPU build (tests); otherwise detected. */
      device?: 'gpu' | 'cpu';
    } = {},
  ) {}

  private get platform() {
    return this.opts.platform ?? process.platform;
  }

  /** The Windows build this computer should use. */
  get build(): EngineBuild {
    return WHISPER_BUILDS[this.opts.device ?? (hasNvidiaGpu(this.platform) ? 'gpu' : 'cpu')];
  }

  private get engineDir(): string {
    return path.join(this.dir, `whisper-${ENGINE_VERSION}-${this.build.kind}`);
  }

  get modelPath(): string {
    return this.opts.modelOverride ?? path.join(this.dir, 'models', WHISPER_MODEL.name);
  }

  private exe(name: 'whisper-cli' | 'whisper-server'): string | null {
    if (this.opts.binaryOverride) {
      const p = name === 'whisper-cli' ? this.opts.binaryOverride : path.join(path.dirname(this.opts.binaryOverride), `${name}${path.extname(this.opts.binaryOverride)}`);
      return fs.existsSync(p) ? p : null;
    }
    if (this.platform === 'win32') {
      const p = path.join(this.engineDir, 'Release', `${name}.exe`);
      return fs.existsSync(p) ? p : null;
    }
    const candidates = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
    for (const d of (process.env.PATH ?? '').split(path.delimiter)) if (d) candidates.push(path.join(d, name));
    return candidates.find((c) => fs.existsSync(c)) ?? null;
  }

  /** whisper-cli location, or null if not installed. */
  binary(): string | null {
    return this.exe('whisper-cli');
  }

  status(): SpeechStatus {
    const engine = this.binary() !== null;
    const model = fs.existsSync(this.modelPath) && fs.statSync(this.modelPath).size === WHISPER_MODEL.bytes;
    const device = this.platform === 'win32' ? this.build.kind : 'mac';
    return {
      engine,
      model,
      ready: engine && model,
      device,
      downloadBytes: (engine || this.platform !== 'win32' ? 0 : this.build.bytes) + (model ? 0 : WHISPER_MODEL.bytes),
      help: !engine && this.platform !== 'win32' ? MAC_HELP : undefined,
    };
  }

  /** Downloads whatever is missing. Safe to call repeatedly; concurrent calls share one install. */
  install(progress: Progress = () => undefined): Promise<void> {
    this.installing ??= this.doInstall(progress).finally(() => (this.installing = null));
    return this.installing;
  }

  private async doInstall(progress: Progress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const needEngine = !this.binary();
    const needModel = !this.status().model;
    const total = (needEngine && this.platform === 'win32' ? this.build.bytes : 0) + (needModel ? WHISPER_MODEL.bytes : 0);
    let done = 0;
    const part = (bytes: number, label: string) => (f: number) => progress(label, total ? (done + f * bytes) / total : 1);
    if (needEngine) {
      if (this.platform !== 'win32') throw new Error(MAC_HELP);
      const b = this.build;
      const zip = path.join(this.dir, `whisper-${ENGINE_VERSION}-${b.kind}.zip`);
      await this.download(b.url, zip, b.sha256, part(b.bytes, b.kind === 'gpu' ? 'Downloading the speech engine for your graphics card' : 'Downloading the speech engine'));
      done += b.bytes;
      progress('Unpacking the speech engine', done / Math.max(1, total));
      await extractZip(zip, this.engineDir);
      fs.rmSync(zip, { force: true });
      // keep only what Jarvis runs (the release also has demos and tests)
      const rel = path.join(this.engineDir, 'Release');
      for (const f of fs.existsSync(rel) ? fs.readdirSync(rel) : []) if (f.endsWith('.exe') && !KEEP_EXE.has(f)) fs.rmSync(path.join(rel, f), { force: true });
    }
    if (needModel) {
      fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
      await this.download(WHISPER_MODEL.url, this.modelPath, WHISPER_MODEL.sha256, part(WHISPER_MODEL.bytes, 'Downloading the speech model'));
    }
    this.removeOldFiles();
  }

  /** Deletes engines and models from older versions (and the other build, if the computer changed). */
  removeOldFiles(): void {
    if (this.opts.modelOverride || this.opts.binaryOverride) return;
    for (const f of OLD_FILES) fs.rmSync(path.join(this.dir, f), { recursive: true, force: true });
    if (!fs.existsSync(this.dir)) return;
    for (const d of fs.readdirSync(this.dir)) {
      if (/^whisper-b\d+-(gpu|cpu)$/.test(d) && path.join(this.dir, d) !== this.engineDir) fs.rmSync(path.join(this.dir, d), { recursive: true, force: true });
    }
  }

  /** Streams to a temp file, checks SHA-256, then moves into place. */
  download(url: string, dest: string, sha256: string, onProgress: (fraction: number) => void): Promise<void> {
    return downloadVerified(this.opts.fetchImpl ?? fetch, url, dest, sha256, onProgress);
  }

  private get threads() {
    return Math.max(1, Math.min(8, os.cpus().length - 1));
  }

  /* ---------- the background server: the model stays loaded ---------- */

  /** Starts whisper-server (once) so the next sentences are fast. Resolves true when it is ready. */
  warmUp(): Promise<boolean> {
    if (this.server) return this.server.ready;
    const bin = this.exe('whisper-server');
    if (!bin || !this.status().model) return Promise.resolve(false);
    const entry: { proc: ChildProcess | null; url: string; ready: Promise<boolean> } = { proc: null, url: '', ready: Promise.resolve(false) };
    this.server = entry;
    entry.ready = (async () => {
      const port = await freePort();
      const proc = spawn(bin, ['-m', this.modelPath, '-l', 'en', '-t', String(this.threads), '--host', '127.0.0.1', '--port', String(port)], {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        cwd: path.dirname(bin),
      });
      entry.proc = proc;
      entry.url = `http://127.0.0.1:${port}`;
      let exited = false;
      const gone = () => {
        exited = true;
        if (this.server === entry) this.server = null;
      };
      proc.on('exit', gone);
      proc.on('error', gone);
      // the model takes a moment to load (onto the graphics card, if there is one)
      for (let i = 0; i < 240 && !exited && this.server === entry; i++) {
        try {
          const r = await fetch(`${entry.url}/`, { signal: AbortSignal.timeout(1000) });
          if (r.status < 500) return true;
        } catch {
          /* not listening yet */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (this.server === entry) this.stopServer();
      return false;
    })();
    return entry.ready;
  }

  stopServer(): void {
    const s = this.server;
    this.server = null;
    try {
      s?.proc?.kill();
    } catch {
      /* already gone */
    }
  }

  private async viaServer(wavPath: string): Promise<string | null> {
    const s = this.server;
    if (!s || !(await s.ready) || this.server !== s) return null;
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'speech.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    if (this.vocabulary) form.append('prompt', this.vocabulary);
    // long speech takes longer to turn into text: allow 2 minutes plus 4 seconds per second of audio
    const seconds = Math.max(0, (fs.statSync(wavPath).size - 44) / 32_000);
    const r = await fetch(`${s.url}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000 + seconds * 4_000) });
    if (!r.ok) throw new Error(`speech server ${r.status}`);
    const j = (await r.json()) as { text?: string; error?: string };
    if (typeof j.text !== 'string') throw new Error(j.error ?? 'no text');
    return j.text;
  }

  /**
   * Transcribes a 16 kHz mono WAV file to plain text. Long speech (a project's specification, a
   * story) goes in pieces cut at pauses, because the engine skips sentences in long recordings.
   */
  async transcribe(wavPath: string): Promise<string> {
    const data = wavData(new Uint8Array(fs.readFileSync(wavPath)));
    const pieces = splitAtPauses(data);
    if (pieces.length <= 1) return this.transcribeOne(wavPath);
    const texts: string[] = [];
    for (const piece of pieces) {
      const part = path.join(os.tmpdir(), `jarvis-part-${crypto.randomBytes(6).toString('hex')}.wav`);
      fs.writeFileSync(part, Buffer.concat([wavHeader(piece.length), piece]));
      try {
        texts.push(await this.transcribeOne(part));
      } finally {
        fs.rmSync(part, { force: true });
      }
    }
    return texts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  private async transcribeOne(wavPath: string): Promise<string> {
    const bin = this.binary();
    if (!bin || !this.status().model) throw new Error('The speech engine is not installed yet.');
    try {
      const text = await this.viaServer(wavPath);
      if (text !== null) return cleanTranscript(text);
    } catch {
      this.stopServer(); // something went wrong: use whisper-cli this time, start fresh next time
    }
    void this.warmUp(); // later sentences go through the server
    return cleanTranscript(await this.viaCli(bin, wavPath));
  }

  private async viaCli(bin: string, wavPath: string): Promise<string> {
    const outBase = path.join(os.tmpdir(), `jarvis-stt-${crypto.randomBytes(6).toString('hex')}`);
    await new Promise<void>((resolve, reject) => {
      const hint = this.vocabulary ? ['--prompt', this.vocabulary] : [];
      const child = spawn(bin, ['-m', this.modelPath, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', String(this.threads), ...hint, ...this.extraArgs, '-otxt', '-of', outBase], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        cwd: path.dirname(bin),
      });
      let err = '';
      child.stderr.on('data', (d) => (err.length < 2000 ? (err += d) : undefined));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`whisper-cli failed (${code}): ${err.slice(-300)}`))));
    });
    const txt = `${outBase}.txt`;
    try {
      return fs.readFileSync(txt, 'utf8');
    } finally {
      fs.rmSync(txt, { force: true });
    }
  }
}

/** A free TCP port on 127.0.0.1 for the speech server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** Joins whisper's lines and drops its non-speech markers like [BLANK_AUDIO] or (music). */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)[^\]]*\]/gi, ' ')
    .replace(/\((?:music|silence|background noise|inaudible|applause)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts a zip with fflate, refusing paths that escape the destination. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const root = path.resolve(destDir);
  for (const [name, data] of Object.entries(files)) {
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`unsafe path in zip: ${name}`);
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
